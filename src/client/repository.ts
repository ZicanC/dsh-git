import { primaryPath } from './graph.ts'
import type {
  BranchId, GraphState, ImportedTurn, PrepareBranchInput, TurnNode, TurnNodeId,
} from './types.ts'

const STORAGE_KEY = 'dsh-git.graph.v1'

function storageKey(scopeId?: string): string {
  return scopeId === undefined
    ? STORAGE_KEY
    : `${STORAGE_KEY}.workspace.${encodeURIComponent(scopeId)}`
}

const EMPTY_STATE: GraphState = {
  format: 1,
  nodes: {},
  branches: {},
  sessionBranches: {},
  sessionTurnRefs: {},
  pendingMerges: {},
  headNodeId: null,
  previewNodeId: null,
  contextManifest: [],
}

interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

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

function parseState(raw: string | null): GraphState {
  if (raw === null) return EMPTY_STATE
  try {
    const value = JSON.parse(raw) as Partial<GraphState>
    if (value.format !== 1 || value.nodes === undefined || value.branches === undefined) return EMPTY_STATE
    return {
      ...EMPTY_STATE,
      ...value,
      contextManifest: Array.isArray(value.contextManifest) ? value.contextManifest : [],
    }
  } catch {
    return EMPTY_STATE
  }
}

/** Persistent observable owning the browser-side conversation DAG. */
export class GraphRepository {
  private state: GraphState
  private readonly listeners = new Set<() => void>()
  private readonly storageKey: string

  /**
   * @param storage - browser storage; omitted keeps an in-memory repository.
   * @param scopeId - one Workspace-folder id; omitted preserves the standalone repository API.
   * @param fallbackState - one-time seed used only when the scoped key does not exist yet.
   */
  constructor(private readonly storage?: BrowserStorage, scopeId?: string, fallbackState?: GraphState) {
    this.storageKey = storageKey(scopeId)
    const raw = storage?.getItem(this.storageKey) ?? null
    this.state = raw === null && fallbackState !== undefined ? fallbackState : parseState(raw)
    if (raw === null && fallbackState !== undefined) {
      storage?.setItem(this.storageKey, JSON.stringify(fallbackState))
    }
  }

  /** Return the stable snapshot until the next mutation. */
  getSnapshot = (): GraphState => this.state

  /** Subscribe to graph mutations. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private commit(next: GraphState): void {
    this.state = next
    this.storage?.setItem(this.storageKey, JSON.stringify(next))
    for (const listener of this.listeners) listener()
  }

  /** Import completed turns from the currently viewed DSH session. */
  syncSession(sessionId: string, turns: readonly ImportedTurn[]): void {
    let next = this.state
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

    let nodes = { ...next.nodes }
    let previousId: TurnNodeId | null = null
    let pending = next.pendingMerges[sessionId]
    for (const turn of [...turns].sort((left, right) => left.turn - right.turn)) {
      const knownId = knownRefs[turn.turn]
      if (knownId !== undefined) {
        const known = nodes[knownId]
        if (known !== undefined && (known.prompt !== turn.prompt || known.answer !== turn.answer)) {
          nodes[knownId] = { ...known, prompt: turn.prompt, answer: turn.answer }
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
      const node: TurnNode = {
        id: nodeId,
        sessionId,
        turn: turn.turn,
        prompt: merge?.prompt ?? turn.prompt,
        answer: turn.answer,
        createdAt: turn.createdAt,
        boundarySeq: turn.boundarySeq,
        primaryParentId,
        parentIds,
        contextManifest: merge?.contextManifest ?? primaryPath({ ...next, nodes }, primaryParentId),
        branchId,
      }
      nodes[nodeId] = node
      knownRefs[turn.turn] = nodeId
      previousId = nodeId
      pending = undefined
    }

    const headId = previousId
    const branch = next.branches[branchId]
    const pendingMerges = { ...next.pendingMerges }
    if (next.pendingMerges[sessionId] !== undefined && pending === undefined) delete pendingMerges[sessionId]
    const shouldSeedTray = next.contextManifest.length === 0 && headId !== null
    const final: GraphState = {
      ...next,
      nodes,
      branches: branch === undefined ? next.branches : {
        ...next.branches,
        [branchId]: { ...branch, headId },
      },
      sessionTurnRefs: { ...next.sessionTurnRefs, [sessionId]: knownRefs },
      pendingMerges,
      headNodeId: headId,
      previewNodeId: next.previewNodeId ?? headId,
      contextManifest: shouldSeedTray ? primaryPath({ ...next, nodes }, headId) : next.contextManifest,
    }
    if (JSON.stringify(final) !== JSON.stringify(this.state)) this.commit(final)
  }

  /** Collapse browser-imported copies from ordinary Host forks into one labeled fork point. */
  reconcileOfficialForks(parents: Readonly<Record<string, string>>): void {
    let next = this.state
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
      const sourceTip = next.nodes[tip.sourceId]!
      const remaining = Object.entries(childRefs)
        .map(([turn, nodeId]) => ({ turn: Number(turn), nodeId }))
        .filter(entry => entry.turn > tip.turn)
        .sort((left, right) => left.turn - right.turn)
      const firstOwnCreatedAt = next.nodes[remaining[0]?.nodeId ?? '']?.createdAt
      const markerCreatedAt = firstOwnCreatedAt === undefined
        ? sourceTip.createdAt + 0.001
        : Math.max(sourceTip.createdAt + 0.001, firstOwnCreatedAt - 0.001)
      const marker: TurnNode = {
        ...sourceTip,
        id: markerId,
        sessionId: childSessionId,
        turn: tip.turn,
        createdAt: markerCreatedAt,
        branchId,
        forkSourceId: tip.sourceId,
      }
      const refs: Record<number, TurnNodeId> = {}
      const replacements = new Map<TurnNodeId, TurnNodeId>()
      for (const entry of prefix.slice(0, -1)) {
        refs[entry.turn] = entry.sourceId
        replacements.set(entry.childId, entry.sourceId)
      }
      refs[tip.turn] = markerId
      replacements.set(tip.childId, markerId)

      let nodes = { ...next.nodes, [markerId]: marker }
      let previousId = markerId
      for (const entry of remaining) {
        const node = nodes[entry.nodeId]
        if (node === undefined) continue
        refs[entry.turn] = entry.nodeId
        nodes[entry.nodeId] = {
          ...node,
          primaryParentId: previousId,
          parentIds: [previousId],
          contextManifest: primaryPath({ ...next, nodes }, previousId),
        }
        previousId = entry.nodeId
      }
      for (const entry of prefix) {
        if (entry.childId === entry.sourceId || entry.childId === markerId) continue
        if (nodes[entry.childId]?.sessionId === childSessionId) delete nodes[entry.childId]
      }
      const replace = (nodeId: TurnNodeId): TurnNodeId => replacements.get(nodeId) ?? nodeId
      nodes = Object.fromEntries(Object.entries(nodes).map(([nodeId, node]) => [nodeId, {
        ...node,
        primaryParentId: node.primaryParentId === null ? null : replace(node.primaryParentId),
        parentIds: distinct(node.parentIds.map(replace)),
        contextManifest: distinct(node.contextManifest.map(replace)),
      }]))
      const contextManifest = distinct(next.contextManifest.map(replace)).filter(nodeId => nodes[nodeId] !== undefined)
      next = {
        ...next,
        nodes,
        branches: { ...next.branches, [branchId]: { ...branch, headId: previousId } },
        sessionTurnRefs: { ...next.sessionTurnRefs, [childSessionId]: refs },
        headNodeId: next.headNodeId === null ? null : replace(next.headNodeId),
        previewNodeId: next.previewNodeId === null ? null : replace(next.previewNodeId),
        contextManifest,
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(this.state)) this.commit(next)
  }

  /** Record an auto-created child session before its first merged request completes. */
  prepareBranch(input: PrepareBranchInput): void {
    const inherited: Record<number, TurnNodeId> = {}
    for (const [index, nodeId] of distinct(input.importedNodeIds).entries()) {
      if (this.state.nodes[nodeId] !== undefined) inherited[index + 1] = nodeId
    }
    const branchId = id('branch') as BranchId
    this.commit({
      ...this.state,
      branches: {
        ...this.state.branches,
        [branchId]: {
          id: branchId,
          name: `merge-${Object.keys(this.state.branches).length + 1}`,
          sessionId: input.childSessionId,
          headId: input.baseNodeId,
          color: Object.keys(this.state.branches).length % 8,
          createdAt: Date.now(),
        },
      },
      sessionBranches: { ...this.state.sessionBranches, [input.childSessionId]: branchId },
      sessionTurnRefs: { ...this.state.sessionTurnRefs, [input.childSessionId]: inherited },
      pendingMerges: {
        ...this.state.pendingMerges,
        [input.childSessionId]: {
          branchId,
          parentIds: distinct(input.parentIds),
          primaryParentId: input.primaryParentId,
          contextManifest: [...input.contextManifest],
          prompt: input.prompt,
        },
      },
      headNodeId: input.baseNodeId,
    })
  }

  /** Remove a pending merge after a rejected prompt. */
  abortPending(sessionId: string): void {
    if (this.state.pendingMerges[sessionId] === undefined) return
    const pendingMerges = { ...this.state.pendingMerges }
    delete pendingMerges[sessionId]
    this.commit({ ...this.state, pendingMerges })
  }

  /** Toggle one node in the context tray; additions restore creation-time order. */
  toggleContext(nodeId: TurnNodeId): void {
    if (this.state.nodes[nodeId] === undefined) return
    const selected = new Set(this.state.contextManifest)
    if (selected.has(nodeId)) {
      selected.delete(nodeId)
      this.commit({ ...this.state, contextManifest: this.state.contextManifest.filter(id => selected.has(id)) })
      return
    }
    const currentlyChronological = this.state.contextManifest.every((id, index, values) =>
      index === 0
      || this.state.nodes[values[index - 1]!]!.createdAt <= this.state.nodes[id]!.createdAt)
    const contextManifest = currentlyChronological
      ? [...selected, nodeId].sort((left, right) =>
        this.state.nodes[left]!.createdAt - this.state.nodes[right]!.createdAt)
      : [...this.state.contextManifest, nodeId]
    this.commit({ ...this.state, contextManifest })
  }

  /** Remove all nodes from the next-request tray. */
  clearContext(): void {
    this.commit({ ...this.state, contextManifest: [] })
  }

  /** Move one selected node before another selected node. */
  moveContext(nodeId: TurnNodeId, beforeId: TurnNodeId): void {
    if (nodeId === beforeId) return
    const next = this.state.contextManifest.filter(id => id !== nodeId)
    const index = next.indexOf(beforeId)
    if (index < 0 || !this.state.contextManifest.includes(nodeId)) return
    next.splice(index, 0, nodeId)
    this.commit({ ...this.state, contextManifest: next })
  }

  /** Move one selected node to the end of the tray. */
  moveContextToEnd(nodeId: TurnNodeId): void {
    if (!this.state.contextManifest.includes(nodeId)) return
    this.commit({
      ...this.state,
      contextManifest: [...this.state.contextManifest.filter(id => id !== nodeId), nodeId],
    })
  }

  /** Change only the preview selection. */
  preview(nodeId: TurnNodeId): void {
    if (this.state.nodes[nodeId] !== undefined) this.commit({ ...this.state, previewNodeId: nodeId })
  }

  /** Rename a branch in the graph ledger. */
  renameBranch(branchId: BranchId, name: string): void {
    const branch = this.state.branches[branchId]
    const normalized = name.trim()
    if (branch === undefined || normalized === '') return
    this.commit({
      ...this.state,
      branches: { ...this.state.branches, [branchId]: { ...branch, name: normalized } },
    })
  }
}
