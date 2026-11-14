import type { GraphState, TurnNode, TurnNodeId } from './types.ts'
import type { ContextRef } from '../graph-state.ts'
import { identityOf } from '../graph-ledger.ts'
import type { HistoryTurnSource } from '../protocol.ts'

/** Where the Host reads a PA from: its Session's log, at the turn's closing boundary. */
export function hostCoordinates(node: TurnNode): HistoryTurnSource {
  return {
    sourceSessionId: node.sessionId,
    sourceTurn: node.turn,
    sourceBoundarySeq: node.boundarySeq,
  }
}

/**
 * The PAs behind a selection, in its order.
 * @returns undefined when the selection is empty or names a PA the ledger no
 *   longer holds — either way there is nothing safe to send to the Host.
 */
export function selectedNodes(state: GraphState, ids: readonly TurnNodeId[]): readonly TurnNode[] | undefined {
  const nodes = ids.flatMap(id => state.nodes[id] === undefined ? [] : [state.nodes[id]!])
  return nodes.length === 0 || nodes.length !== ids.length ? undefined : nodes
}

/** Freeze the history path independently from the physical node's owner. */
export function contextReferences(
  state: GraphState, manifest: readonly TurnNodeId[], via: Readonly<Record<string, string>> = {},
): readonly ContextRef[] {
  return manifest.map(id => {
    const node = state.nodes[id]
    if (node === undefined) throw new Error(`Missing selected PA: ${id}`)
    return { paId: identityOf(state, id), viaSessionId: via[id] ?? node.sessionId }
  })
}

export function resolveContextReferences(state: GraphState, refs: readonly ContextRef[]): readonly TurnNodeId[] {
  const identities = new Set<string>()
  return refs.map(ref => {
    if (identities.has(ref.paId)) throw new Error('Duplicate Context PA identity')
    identities.add(ref.paId)
    const matches = Object.values(state.sessionTurnRefs[ref.viaSessionId] ?? {})
      .filter(id => state.nodes[id] !== undefined && identityOf(state, id) === ref.paId)
    if (matches.length !== 1) throw new Error(`Invalid Context history reference: ${ref.viaSessionId}`)
    return matches[0]!
  })
}

/** Return nodes in stable creation order with ids breaking timestamp ties. */
export function orderedNodes(state: GraphState): readonly TurnNode[] {
  return Object.values(state.nodes).sort((left, right) =>
    (left.finalOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.finalOrdinal ?? Number.MAX_SAFE_INTEGER)
    || left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

/**
 * Whether a selection joins lineages rather than continuing one.
 *
 * A selection drawn from a single Session — the current Chat's own history,
 * trimmed or reordered — branches that lineage: that is a Fork. Only PAs
 * pulled from a second Session make the new Chat a Merge.
 */
export function joinsLineages(state: GraphState, manifest: readonly TurnNodeId[], refs?: readonly ContextRef[]): boolean {
  if (refs !== undefined) return new Set(refs.map(ref => ref.viaSessionId)).size > 1
  const sessions = new Set(normalizeContextOccurrences(state, manifest).flatMap((id) => {
    const node = state.nodes[id]
    return node === undefined ? [] : [node.sessionId]
  }))
  return sessions.size > 1
}

/** Resolve every visual fork copy to the original PA identity it represents. */
export function paIdentityId(state: GraphState, nodeId: TurnNodeId): TurnNodeId {
  const visited = new Set<TurnNodeId>()
  let cursor = nodeId
  while (!visited.has(cursor)) {
    visited.add(cursor)
    const source = state.nodes[cursor]?.forkSourceId
    if (source === undefined || state.nodes[source] === undefined) return cursor
    cursor = source
  }
  // Malformed cycles remain deterministic and are rejected by the durable
  // validation layer once occurrence identity becomes part of the schema.
  return [...visited].sort()[0] ?? nodeId
}

/**
 * Keep one occurrence per PA identity without moving its original Tray slot.
 *
 * Selecting another fork copy replaces the occurrence stored in that slot;
 * it never adds a second copy of the same PA to the outgoing Context.
 */
export function normalizeContextOccurrences(
  state: GraphState,
  manifest: readonly TurnNodeId[],
): readonly TurnNodeId[] {
  const entries = new Map<TurnNodeId, { nodeId: TurnNodeId, firstIndex: number }>()
  manifest.forEach((nodeId, index) => {
    if (state.nodes[nodeId] === undefined) return
    const identityId = paIdentityId(state, nodeId)
    const existing = entries.get(identityId)
    entries.set(identityId, { nodeId, firstIndex: existing?.firstIndex ?? index })
  })
  return [...entries.values()]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map(entry => entry.nodeId)
}

/** Parent endpoints derived from one ordered Context Tray snapshot. */
export interface LineageParentPlan {
  readonly parentIds: readonly TurnNodeId[]
  readonly primaryParentId: TurnNodeId | null
}

/**
 * Keep only the last selected PA from each source Session.
 *
 * The surviving endpoints retain the order of their own final Tray positions,
 * rather than the order in which their Sessions first appeared. The final
 * surviving endpoint is therefore also the layout-primary parent.
 */
export function lineageParentPlan(
  state: GraphState,
  manifest: readonly TurnNodeId[],
  refs?: readonly ContextRef[],
): LineageParentPlan {
  const terminalBySession = new Map<string, { readonly nodeId: TurnNodeId, readonly index: number }>()
  const occurrences = refs === undefined ? normalizeContextOccurrences(state, manifest) : resolveContextReferences(state, refs)
  occurrences.forEach((nodeId, index) => {
    const node = state.nodes[nodeId]
    if (node !== undefined) terminalBySession.set(refs?.[index]?.viaSessionId ?? node.sessionId, { nodeId, index })
  })
  const parentIds = [...terminalBySession.values()]
    .sort((left, right) => left.index - right.index)
    .map(entry => entry.nodeId)
  return { parentIds, primaryParentId: parentIds.at(-1) ?? null }
}

/** Estimate prompt tokens without coupling the browser plugin to a tokenizer. */
export function estimateTokens(state: GraphState, manifest: readonly TurnNodeId[]): number {
  const characters = manifest.reduce((total, id) => {
    const node = state.nodes[id]
    return total + (node === undefined ? 0 : node.prompt.length + node.answer.length)
  }, 0)
  return Math.ceil(characters / 4)
}
