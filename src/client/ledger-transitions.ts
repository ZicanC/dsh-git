/**
 * Pure transitions of the browser's graph ledger.
 *
 * Each function takes one ledger and returns the next; none of them touches
 * the transport or notifies listeners. `./repository.ts` owns persistence and
 * commits whatever these return.
 */
import { identityOf, repairOccurrences, replaceNodes } from '../graph-ledger.ts'
import { normalizeContextOccurrences } from './graph.ts'
import type {
  BranchId, GraphState, ImportedTurn, PrepareMergedSessionInput, TurnNode, TurnNodeId,
} from './types.ts'

function id(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${suffix}`
}

function distinct(ids: readonly TurnNodeId[]): readonly TurnNodeId[] {
  return [...new Set(ids)]
}

function officialForkNodeId(sessionId: string, turn: number): TurnNodeId {
  return `fork-${encodeURIComponent(sessionId)}-${turn}`
}

/** Import one Session's completed turns, minting a node for each turn not yet known. */
export function syncSessionTurns(state: GraphState, sessionId: string, turns: readonly ImportedTurn[]): GraphState {
  let next = state
  const knownRefs = { ...(next.sessionTurnRefs[sessionId] ?? {}) }
  let branchId = next.sessionBranches[sessionId]
  if (branchId === undefined) {
    branchId = id('branch')
    next = {
      ...next,
      branches: {
        ...next.branches,
        [branchId]: {
          id: branchId,
          name: `branch-${Object.keys(next.branches).length + 1}`,
          sessionId,
          headId: null,
          color: Object.keys(next.branches).length % 8,
          createdAt: turns[0]?.createdAt ?? Date.now(),
        },
      },
      sessionBranches: { ...next.sessionBranches, [sessionId]: branchId },
    }
  }

  const nodes = { ...next.nodes }
  let previousId: TurnNodeId | null = null
  let pending = next.pendingMerges[sessionId]
  for (const turn of [...turns].sort((left, right) => left.turn - right.turn)) {
    const knownId = knownRefs[turn.turn]
    if (knownId !== undefined) {
      const known = nodes[knownId]
      if (known !== undefined) {
        // A composed Fork copy is registered before its Session exists, with
        // the source's boundary. Once the Session's own log is read, the copy
        // takes the coordinates that address it there.
        const boundarySeq = known.sessionId === sessionId ? turn.boundarySeq : known.boundarySeq
        if (known.prompt !== turn.prompt || known.answer !== turn.answer || known.boundarySeq !== boundarySeq) {
          nodes[knownId] = { ...known, prompt: turn.prompt, answer: turn.answer, boundarySeq }
        }
      }
      previousId = knownId
      continue
    }

    const nodeId = id('pa')
    const merge = pending
    const parentIds = merge === undefined
      ? previousId === null ? [] : [previousId]
      : distinct(merge.parentIds)
    const primaryParentId = merge?.primaryParentId ?? previousId
    nodes[nodeId] = {
      id: nodeId,
      sessionId,
      turn: turn.turn,
      prompt: turn.prompt,
      answer: turn.answer,
      createdAt: turn.createdAt,
      boundarySeq: turn.boundarySeq,
      primaryParentId,
      parentIds,
      contextManifest: merge?.contextManifest ?? [],
      contextKnown: merge !== undefined,
      ...(merge?.contextRefs === undefined ? {} : { contextRefs: merge.contextRefs }),
      branchId,
    }
    knownRefs[turn.turn] = nodeId
    previousId = nodeId
    pending = undefined
  }

  const headId = previousId
  const branch = next.branches[branchId]
  const pendingMerges = { ...next.pendingMerges }
  if (next.pendingMerges[sessionId] !== undefined && pending === undefined) delete pendingMerges[sessionId]
  // `headNodeId`, `previewNodeId`, and the ledger-level `contextManifest` are
  // deliberately left alone. One ledger serves every Chat of a Workspace, so
  // which Chat is on screen is not ledger state: each Session's head lives on
  // its branch, and selection lives in the view.
  return {
    ...next,
    nodes,
    branches: branch === undefined ? next.branches : {
      ...next.branches,
      [branchId]: { ...branch, headId },
    },
    sessionTurnRefs: { ...next.sessionTurnRefs, [sessionId]: knownRefs },
    pendingMerges,
  }
}

/**
 * Fold the prefix an official Harness fork copied from its parent back into
 * the parent's own PAs, leaving one fork occurrence at the tip.
 *
 * The copied turns are the same PAs as the parent's, so the child Session's
 * history points at the parent's nodes and only the last copied turn stays
 * visible, as a fork occurrence the child's own turns continue from. When the
 * copies were numbered first (the fork was read before its parent), the
 * parent's nodes take over those numbers: a label already shown never changes
 * and no number is left unused.
 */
export function reconcileOfficialForks(state: GraphState, parents: Readonly<Record<string, string>>): GraphState {
  let next = state
  for (const [childSessionId, parentSessionId] of Object.entries(parents)) {
    if (childSessionId.startsWith('dsh-git-')) continue
    const childRefs = next.sessionTurnRefs[childSessionId]
    const parentRefs = next.sessionTurnRefs[parentSessionId]
    if (childRefs === undefined || parentRefs === undefined) continue

    const prefix: Array<{ turn: number; childId: TurnNodeId; sourceId: TurnNodeId }> = []
    for (const [rawTurn, childId] of Object.entries(childRefs).sort(([left], [right]) => Number(left) - Number(right))) {
      const turn = Number(rawTurn)
      const sourceId = parentRefs[turn]
      if (sourceId === undefined) break
      const child = next.nodes[childId]
      const source = next.nodes[sourceId]
      if (child === undefined || source === undefined
        || child.prompt !== source.prompt || child.answer !== source.answer) break
      prefix.push({ turn, childId, sourceId })
    }
    const tip = prefix.at(-1)
    if (tip === undefined) continue
    const branchId = next.sessionBranches[childSessionId]
    const branch = branchId === undefined ? undefined : next.branches[branchId]
    if (branchId === undefined || branch === undefined) continue

    const markerId = officialForkNodeId(childSessionId, tip.turn)
    const nodes = { ...next.nodes }
    const replacements = new Map<TurnNodeId, TurnNodeId>()
    for (const entry of prefix) {
      const copy = nodes[entry.childId]!
      const replacementId = entry === tip ? markerId : entry.sourceId
      if (entry.childId === replacementId || copy.sessionId !== childSessionId) continue
      replacements.set(entry.childId, replacementId)
      const source = nodes[entry.sourceId]!
      if (copy.forkSourceId !== undefined || copy.ledgerOrdinal === undefined || source.ledgerOrdinal !== undefined) continue
      nodes[entry.sourceId] = {
        ...source,
        paId: source.paId ?? copy.paId ?? identityOf(next, copy.id),
        ledgerOrdinal: copy.ledgerOrdinal,
        finalOrdinal: copy.finalOrdinal,
      }
    }

    const sourceTip = nodes[tip.sourceId]!
    const remaining = Object.entries(childRefs)
      .map(([turn, nodeId]) => ({ turn: Number(turn), nodeId }))
      .filter(entry => entry.turn > tip.turn)
      .sort((left, right) => left.turn - right.turn)
    const firstOwnCreatedAt = nodes[remaining[0]?.nodeId ?? '']?.createdAt
    nodes[markerId] = {
      ...sourceTip,
      id: markerId,
      sessionId: childSessionId,
      turn: tip.turn,
      createdAt: firstOwnCreatedAt === undefined
        ? sourceTip.createdAt + 0.001
        : Math.max(sourceTip.createdAt + 0.001, firstOwnCreatedAt - 0.001),
      finalOrdinal: next.nodes[markerId]?.finalOrdinal,
      branchId,
      primaryParentId: null,
      parentIds: [],
      forkSourceId: tip.sourceId,
    }

    const refs: Record<number, TurnNodeId> = {}
    for (const entry of prefix) refs[entry.turn] = entry === tip ? markerId : entry.sourceId
    let previousId = markerId
    for (const entry of remaining) {
      const node = nodes[entry.nodeId]
      if (node === undefined) continue
      refs[entry.turn] = entry.nodeId
      nodes[entry.nodeId] = {
        ...node,
        primaryParentId: previousId,
        parentIds: [previousId],
        contextManifest: node.contextKnown === true ? node.contextManifest : [],
        contextKnown: node.contextKnown ?? false,
      }
      previousId = entry.nodeId
    }

    const replaced = replaceNodes({
      ...next,
      nodes,
      branches: { ...next.branches, [branchId]: { ...branch, headId: previousId } },
      sessionTurnRefs: { ...next.sessionTurnRefs, [childSessionId]: refs },
    }, replacements)
    next = { ...replaced, contextManifest: normalizeContextOccurrences(replaced, replaced.contextManifest) }
  }
  return next
}

/**
 * Register a composed child Session before its first new official turn.
 *
 * The child's history points at the selected PAs. A selection from a single
 * lineage is a Fork: its tip becomes a fork occurrence owned by the child, and
 * the first new turn continues from that occurrence. The recipe is kept as a
 * pending merge until that first turn completes.
 */
export function prepareMergedSession(state: GraphState, input: PrepareMergedSessionInput): GraphState {
  const inherited: Record<number, TurnNodeId> = {}
  for (const [index, nodeId] of distinct(input.importedNodeIds).entries()) {
    if (state.nodes[nodeId] !== undefined) inherited[index + 1] = nodeId
  }
  const branchId = id('branch') as BranchId
  const sourceParentIds = distinct(input.parentIds)
  let nodes = state.nodes
  let inheritedHeadId = Object.values(inherited).at(-1) ?? input.primaryParentId
  let pendingParentIds = sourceParentIds
  let pendingPrimaryParentId = input.primaryParentId
  const inheritedTurn = Object.keys(inherited).map(Number).at(-1)
  const forkSourceId = sourceParentIds.length === 1 ? sourceParentIds[0] : undefined
  const forkSource = forkSourceId === undefined ? undefined : state.nodes[forkSourceId]
  if (forkSource !== undefined && inheritedTurn !== undefined) {
    const markerId = officialForkNodeId(input.childSessionId, inheritedTurn)
    const marker: TurnNode = {
      ...forkSource,
      id: markerId,
      sessionId: input.childSessionId,
      turn: inheritedTurn,
      createdAt: Date.now(),
      finalOrdinal: undefined,
      branchId,
      primaryParentId: null,
      parentIds: [],
      forkSourceId,
    }
    nodes = { ...nodes, [markerId]: marker }
    inherited[inheritedTurn] = markerId
    inheritedHeadId = markerId
    pendingParentIds = [markerId]
    pendingPrimaryParentId = markerId
  }
  return {
    ...state,
    nodes,
    branches: {
      ...state.branches,
      [branchId]: {
        id: branchId,
        name: `merge-${Object.keys(state.branches).length + 1}`,
        sessionId: input.childSessionId,
        headId: inheritedHeadId,
        color: Object.keys(state.branches).length % 8,
        createdAt: Date.now(),
      },
    },
    sessionBranches: { ...state.sessionBranches, [input.childSessionId]: branchId },
    sessionTurnRefs: { ...state.sessionTurnRefs, [input.childSessionId]: inherited },
    pendingMerges: {
      ...state.pendingMerges,
      [input.childSessionId]: {
        branchId,
        parentIds: pendingParentIds,
        primaryParentId: pendingPrimaryParentId,
        contextManifest: [...input.contextManifest],
        ...(input.contextRefs === undefined ? {} : { contextRefs: input.contextRefs }),
      },
    },
  }
}

/**
 * Union a Host-observed Workspace graph into the ledger without replacing the
 * ledger's own records, branch names, or pending merge metadata.
 *
 * Project assembly reuses every known browser id before minting fallback ids,
 * so the union makes previously unopened Session turns available to a later
 * composed child without duplicating them.
 */
export function adoptObservedGraph(state: GraphState, observed: GraphState): GraphState {
  const sessionTurnRefs = { ...observed.sessionTurnRefs }
  for (const [sessionId, refs] of Object.entries(state.sessionTurnRefs)) {
    sessionTurnRefs[sessionId] = { ...(sessionTurnRefs[sessionId] ?? {}), ...refs }
  }
  // Observed graphs can originate in another scope; only our ledger owns numbering.
  const imported = Object.fromEntries(Object.entries(observed.nodes).map(([id, node]) => [id,
    state.nodes[id] === undefined ? { ...node, ledgerOrdinal: undefined, finalOrdinal: undefined } : node,
  ]))
  const nodes = { ...imported, ...state.nodes }
  // The observed graph may name a turn this ledger already holds under
  // another id. The ledger's own record wins; the observed one is folded
  // into it instead of becoming a second occurrence.
  return repairOccurrences({
    ...state,
    nodes,
    branches: { ...observed.branches, ...state.branches },
    sessionBranches: { ...observed.sessionBranches, ...state.sessionBranches },
    sessionTurnRefs,
  })
}
