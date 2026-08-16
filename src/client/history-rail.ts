import { estimateTokens, orderedNodes } from './graph.ts'
import { nodeLabelMap } from './labels.ts'
import type { GraphState, TurnNodeId } from './types.ts'

/** How one turn participates in the merge the workbench is composing. */
export type HistoryRailState = 'included' | 'preview'

/** One row of the conversation trail, and the dash that stands in for it. */
export interface HistoryRailEntry {
  readonly nodeId: TurnNodeId
  readonly label: string
  /** Single-line prompt shown on the row. */
  readonly prompt: string
  readonly state: HistoryRailState
  readonly head: boolean
  /** Branch depth, capped so a deep DAG never pushes the prompt out of view. */
  readonly indent: number
  /** Whether the row belongs to a visible side branch and needs an elbow. */
  readonly branched: boolean
  /** Dash width in px, mapped from this turn's estimated token weight. */
  readonly width: number
}

/** Complete drawing model for the Chat History rail. */
export interface HistoryRailModel {
  readonly entries: readonly HistoryRailEntry[]
  readonly includedCount: number
  readonly previewCount: number
}

/** Which turns the rail lists, and how each of them is currently marked. */
export interface HistoryRailInput {
  readonly selectedIds: readonly TurnNodeId[]
  readonly candidateId: TurnNodeId | null
  readonly headNodeId: TurnNodeId | null
  /**
   * The exact Context order rendered by Chat History, including a candidate at
   * its tentative insertion point. Unselected nodes are never added to the
   * floating rail, even if a stale ordering input still mentions one.
   */
  readonly orderedIds?: readonly TurnNodeId[]
}

const MIN_DASH = 9
const MAX_DASH = 18
const MAX_INDENT = 3

export const EMPTY_HISTORY_RAIL: HistoryRailModel = {
  entries: [], includedCount: 0, previewCount: 0,
}

function oneLine(value: string, maximum: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maximum ? collapsed : `${collapsed.slice(0, maximum - 1)}…`
}

/**
 * Build the rail from exactly the committed Context plus its one candidate.
 * The ordering follows Chat History, while every unselected graph node stays
 * out of the floating rail.
 *
 * Indentation reuses the lane rule the graph itself draws with — a turn keeps
 * its parent's lane only as that parent's first child, so a second child reads
 * as a branch off the spine.
 */
export function historyRailModel(state: GraphState, input: HistoryRailInput): HistoryRailModel {
  const included = new Set(input.selectedIds)
  const candidate = input.candidateId !== null && !included.has(input.candidateId)
    ? input.candidateId
    : null
  const visible = new Set<TurnNodeId>(input.selectedIds)
  if (candidate !== null) visible.add(candidate)

  const trajectoryNodes = orderedNodes(state).filter(node => visible.has(node.id))
  if (trajectoryNodes.length === 0) return EMPTY_HISTORY_RAIL

  const byId = new Map(trajectoryNodes.map(node => [node.id, node]))
  const preferredIds = input.orderedIds ?? trajectoryNodes.map(node => node.id)
  const orderedIds: TurnNodeId[] = []
  const seen = new Set<TurnNodeId>()
  const append = (nodeId: TurnNodeId): void => {
    if (seen.has(nodeId) || !byId.has(nodeId)) return
    seen.add(nodeId)
    orderedIds.push(nodeId)
  }
  preferredIds.forEach(append)
  trajectoryNodes.forEach(node => append(node.id))
  const nodes = orderedIds.flatMap(nodeId => {
    const node = byId.get(nodeId)
    return node === undefined ? [] : [node]
  })

  const labels = nodeLabelMap(state)
  const lanes = new Map<TurnNodeId, number>()
  const childCount = new Map<TurnNodeId, number>()
  const branched = new Map<TurnNodeId, boolean>()
  let nextLane = 1

  // Compute lanes in graph order so a user reordering Context does not invent
  // or erase topology. Independent roots always restart on the spine.
  for (const node of trajectoryNodes) {
    const parentId = node.primaryParentId
    const parentLane = parentId === null ? undefined : lanes.get(parentId)
    if (parentId === null || parentLane === undefined) {
      lanes.set(node.id, 0)
      branched.set(node.id, false)
      continue
    }
    const siblings = childCount.get(parentId) ?? 0
    childCount.set(parentId, siblings + 1)
    const lane = siblings === 0 ? parentLane : nextLane++
    lanes.set(node.id, lane)
    branched.set(node.id, lane > 0)
  }

  const weights = nodes.map(node => estimateTokens(state, [node.id]))
  const lightest = Math.min(...weights)
  const heaviest = Math.max(...weights)
  const span = heaviest - lightest

  const entries = nodes.map((node, index): HistoryRailEntry => {
    const weight = weights[index] ?? 0
    return {
      nodeId: node.id,
      label: labels.get(node.id) ?? 'PA',
      prompt: oneLine(node.prompt, 120),
      state: included.has(node.id) ? 'included' : 'preview',
      head: node.id === input.headNodeId,
      indent: Math.min(lanes.get(node.id) ?? 0, MAX_INDENT),
      branched: branched.get(node.id) ?? false,
      width: span === 0
        ? Math.round((MIN_DASH + MAX_DASH) / 2)
        : MIN_DASH + Math.round(((weight - lightest) / span) * (MAX_DASH - MIN_DASH)),
    }
  })

  return {
    entries,
    includedCount: entries.filter(entry => entry.state === 'included').length,
    previewCount: entries.filter(entry => entry.state === 'preview').length,
  }
}
