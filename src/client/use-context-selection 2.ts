/** The Context being assembled in the Branches view: which PAs, in what order, reached through which Session. */
import { useEffect, useMemo, useState } from 'react'
import { paIdentityId } from './graph.ts'
import type { AnchorModeState, GraphState, TurnNodeId } from './types.ts'

function sessionHistory(state: GraphState, sessionId: string): TurnNodeId[] {
  return [...new Set(Object.entries(state.sessionTurnRefs[sessionId] ?? {})
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([, nodeId]) => state.nodes[nodeId] === undefined ? [] : [nodeId]))]
}

function sameIds(left: readonly TurnNodeId[], right: readonly TurnNodeId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** The selection and the edits the view can make to it. */
export interface ContextSelection {
  /** The Chat's own history: what the selection is when nothing was edited. */
  readonly currentSessionIds: readonly TurnNodeId[]
  /** The selected PAs, in Context order. */
  readonly selectedIds: readonly TurnNodeId[]
  /** The history the selection was last reset to; a difference from it is an unmerged edit. */
  readonly baselineIds: readonly TurnNodeId[]
  /** The PA whose Context window is open, if any. Inspecting never changes the selection. */
  readonly inspectedId: TurnNodeId | null
  /** Whether the selection differs from the Chat's own history. Never true while anchored. */
  readonly dirty: boolean
  /** The Session each selected PA is reached through, by node id. */
  readonly sources: Readonly<Record<string, string>>
  /** Open a PA's Context window. @returns false when the selection is locked. */
  readonly inspect: (nodeId: TurnNodeId) => boolean
  /** Close the Context window and return focus to the node that opened it. */
  readonly closeInspector: () => void
  /** Add the inspected PA, replacing another occurrence of the same PA in place. */
  readonly addInspected: () => void
  readonly remove: (nodeId: TurnNodeId) => void
  /** Move a selected PA in front of another. */
  readonly move: (nodeId: TurnNodeId, beforeId: TurnNodeId) => void
  readonly moveEnd: (nodeId: TurnNodeId) => void
  /**
   * Return to the Chat's own history and follow it again.
   * @param forgetPaths - also drop the Sessions that PAs were re-reached through.
   */
  readonly reset: (forgetPaths: boolean) => void
}

/**
 * Own the Context selection of one Branches view.
 *
 * Untouched, the selection is the Chat's own history and follows it: a turn
 * that completes joins it. The first edit stops that; undoing every edit
 * starts it again. While an anchor is active the selection is the anchored
 * PAs and cannot be edited.
 * @param state - the graph the selection is drawn from.
 * @param anchor - the active anchor of this Chat, if any.
 * @param locked - whether edits are refused: an action is in flight, or the Chat is anchored.
 */
export function useContextSelection(
  state: GraphState,
  sessionId: string,
  anchor: AnchorModeState | undefined,
  locked: boolean,
): ContextSelection {
  const [selectionVia, setSelectionVia] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<TurnNodeId[]>([])
  const [baselineIds, setBaselineIds] = useState<TurnNodeId[]>([])
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [inspectedId, setInspectedId] = useState<TurnNodeId | null>(null)

  const currentSessionIds = useMemo(() => sessionHistory(state, sessionId), [state, sessionId])
  const currentSessionKey = currentSessionIds.join('\u0000')
  // Keyed on the history's content, not its array identity: every ledger
  // snapshot yields a new array for the same history.
  useEffect(() => {
    if (selectionTouched) return
    setBaselineIds(currentSessionIds)
    setSelectedIds(currentSessionIds)
  }, [currentSessionKey, selectionTouched])

  useEffect(() => {
    if (anchor === undefined) return
    const fixed = anchor.nodeIds.filter(nodeId => state.nodes[nodeId] !== undefined)
    setSelectedIds(fixed)
    setInspectedId(null)
    setSelectionTouched(true)
  }, [anchor, state.nodes])

  const sourcePathsChanged = baselineIds.some(id => selectionVia[id] !== undefined && selectionVia[id] !== sessionId)

  // A selection edited back to the baseline is not a lasting edit. Re-arm
  // baseline following so a later official turn joins the blue history.
  useEffect(() => {
    if (selectionTouched && sameIds(selectedIds, baselineIds) && !sourcePathsChanged) {
      setSelectionTouched(false)
    }
  }, [selectionTouched, selectedIds, baselineIds, sourcePathsChanged])

  const sources = Object.fromEntries(selectedIds.map(id => [id,
    selectionVia[id] ?? (currentSessionIds.includes(id) ? sessionId : state.nodes[id]?.sessionId ?? ''),
  ]))

  const commitOrder = (next: readonly TurnNodeId[]): void => {
    setSelectedIds([...next])
    setSelectionTouched(true)
  }

  return {
    currentSessionIds,
    selectedIds,
    baselineIds,
    inspectedId,
    dirty: anchor === undefined && (!sameIds(selectedIds, baselineIds) || sourcePathsChanged),
    sources,
    inspect: (nodeId) => {
      if (locked) return false
      setInspectedId(nodeId)
      return true
    },
    closeInspector: () => {
      const closingId = inspectedId
      setInspectedId(null)
      if (closingId !== null) {
        const trigger = [...document.querySelectorAll<HTMLButtonElement>('.dsh-git-tree-node')]
          .find(button => button.dataset.nodeId === closingId)
        trigger?.focus()
      }
    },
    addInspected: () => {
      if (locked) return
      if (inspectedId === null || state.nodes[inspectedId] === undefined) return
      setSelectionVia(via => ({ ...via, [inspectedId]: state.nodes[inspectedId]!.sessionId }))
      // Inspecting is read-only. Only this explicit action changes Context.
      setSelectedIds((ids) => {
        const identityId = paIdentityId(state, inspectedId)
        const existingIndex = ids.findIndex(nodeId => paIdentityId(state, nodeId) === identityId)
        if (existingIndex < 0) return [...ids, inspectedId]
        if (ids[existingIndex] === inspectedId) return ids
        const next = [...ids]
        next[existingIndex] = inspectedId
        return next
      })
      setSelectionTouched(true)
    },
    remove: (nodeId) => {
      if (locked) return
      setSelectedIds(ids => ids.filter(id => id !== nodeId))
      if (inspectedId === nodeId) setInspectedId(null)
      setSelectionTouched(true)
    },
    move: (nodeId, beforeId) => {
      if (locked) return
      if (nodeId === beforeId || !selectedIds.includes(nodeId)) return
      const next = selectedIds.filter(id => id !== nodeId)
      const index = next.indexOf(beforeId)
      if (index < 0) return
      next.splice(index, 0, nodeId)
      commitOrder(next)
    },
    moveEnd: (nodeId) => {
      if (locked) return
      if (!selectedIds.includes(nodeId)) return
      commitOrder([...selectedIds.filter(id => id !== nodeId), nodeId])
    },
    reset: (forgetPaths) => {
      if (forgetPaths) setSelectionVia({})
      setSelectedIds(currentSessionIds)
      setBaselineIds(currentSessionIds)
      setSelectionTouched(false)
      setInspectedId(null)
    },
  }
}
