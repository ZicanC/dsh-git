import { primaryPath } from './graph.ts'
import type { GraphTransport } from './graph-transport.ts'
import { EMPTY_GRAPH_STATE } from './types.ts'
import type {
  BranchId, GraphState, ImportedTurn, PrepareMergedSessionInput, TurnNode, TurnNodeId,
} from './types.ts'

const EMPTY_STATE = EMPTY_GRAPH_STATE

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

/**
 * Observable owning one scope's conversation DAG, durable on the Host.
 *
 * Reads stay synchronous — React subscribes through `useSyncExternalStore` —
 * so every mutation lands in memory first and is pushed to the Host after.
 * Until {@link hydrate} resolves the repository holds the empty ledger and
 * defers mutations rather than applying them, because a `syncSession` that ran
 * against the empty state would mint fresh node ids for turns the Host already
 * knows and then overwrite the stored ledger with the duplicates.
 */
export class GraphRepository {
  private state: GraphState = EMPTY_STATE
  private readonly listeners = new Set<() => void>()
  private hydrated = false
  private deferred: Array<() => void> = []

  /**
   * @param transport - Host ledger access; omitted keeps an in-memory repository
   *   that is hydrated from the start (used by tests and by a Host that has not
   *   loaded the plugin's storage domain).
   * @param scopeId - the ledger's owning scope; omitted with a transport is invalid.
   */
  constructor(private readonly transport?: GraphTransport, private readonly scopeId?: string) {
    this.hydrated = transport === undefined || scopeId === undefined
  }

  /** Return the stable snapshot until the next mutation. */
  getSnapshot = (): GraphState => this.state

  /** Subscribe to graph mutations. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** True once the Host ledger has landed and mutations apply immediately. */
  get ready(): boolean { return this.hydrated }

  /**
   * Load this scope's stored ledger once, then release any deferred mutations.
   *
   * A failed read still opens the gate: the graph rebuilds itself from the
   * session logs the browser is already displaying, which is a better outcome
   * than a permanently frozen tab.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated || this.transport === undefined || this.scopeId === undefined) return
    let loaded = EMPTY_STATE
    try {
      loaded = await this.transport.read(this.scopeId)
    } finally {
      this.hydrated = true
      this.state = loaded
      const pending = this.deferred
      this.deferred = []
      for (const mutation of pending) mutation()
      for (const listener of this.listeners) listener()
    }
  }

  /** Apply one mutation now, or hold it until the Host ledger has landed. */
  private run(mutation: () => void): void {
    if (this.hydrated) mutation()
    else this.deferred.push(mutation)
  }

  private commit(next: GraphState): void {
    this.state = next
    if (this.transport !== undefined && this.scopeId !== undefined) {
      void this.transport.write(this.scopeId, next).catch(() => undefined)
    }
    for (const listener of this.listeners) listener()
  }

  /** Import completed turns from the currently viewed DSH session. */
  syncSession(sessionId: string, turns: readonly ImportedTurn[]): void {
    this.run(() => { this.syncSessionNow(sessionId, turns) })
  }

  /**
   * Adopt a complete Host-observed Workspace graph without replacing local
   * branch names, pending merge metadata, or transient view state.
   *
   * Project assembly reuses every known browser id before minting fallback
   * ids, so this union also makes previously unopened Session turns available
   * to a later merged child without duplicating them in the ledger.
   */
  adoptObservedGraph(observed: GraphState): void {
    this.run(() => {
      const sessionTurnRefs = { ...observed.sessionTurnRefs }
      for (const [sessionId, refs] of Object.entries(this.state.sessionTurnRefs)) {
        sessionTurnRefs[sessionId] = { ...(sessionTurnRefs[sessionId] ?? {}), ...refs }
      }
      const nodes = { ...observed.nodes, ...this.state.nodes }
      const headNodeId = this.state.headNodeId !== null && nodes[this.state.headNodeId] !== undefined
        ? this.state.headNodeId
        : observed.headNodeId
      const previewNodeId = this.state.previewNodeId !== null && nodes[this.state.previewNodeId] !== undefined
        ? this.state.previewNodeId
        : null
      const next: GraphState = {
        ...this.state,
        nodes,
        branches: { ...observed.branches, ...this.state.branches },
        sessionBranches: { ...observed.sessionBranches, ...this.state.sessionBranches },
        sessionTurnRefs,
        headNodeId,
        previewNodeId,
      }
      if (JSON.stringify(next) !== JSON.stringify(this.state)) this.commit(next)
    })
  }

  private syncSessionNow(sessionId: string, turns: readonly ImportedTurn[]): void {
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
        prompt: turn.prompt,
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
    this.run(() => { this.reconcileOfficialForksNow(parents) })
  }

  private reconcileOfficialForksNow(parents: Readonly<Record<string, string>>): void {
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

  /** Register a merged child Session before its first new official turn. */
  prepareMergedSession(input: PrepareMergedSessionInput): void {
    this.run(() => { this.prepareMergedSessionNow(input) })
  }

  private prepareMergedSessionNow(input: PrepareMergedSessionInput): void {
    const inherited: Record<number, TurnNodeId> = {}
    for (const [index, nodeId] of distinct(input.importedNodeIds).entries()) {
      if (this.state.nodes[nodeId] !== undefined) inherited[index + 1] = nodeId
    }
    const inheritedHeadId = Object.values(inherited).at(-1) ?? input.primaryParentId
    const branchId = id('branch') as BranchId
    this.commit({
      ...this.state,
      branches: {
        ...this.state.branches,
        [branchId]: {
          id: branchId,
          name: `merge-${Object.keys(this.state.branches).length + 1}`,
          sessionId: input.childSessionId,
          headId: inheritedHeadId,
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
        },
      },
      headNodeId: inheritedHeadId,
    })
  }

  /** Remove pending metadata for an abandoned merged Session. */
  abortPending(sessionId: string): void {
    this.run(() => {
      if (this.state.pendingMerges[sessionId] === undefined) return
      const pendingMerges = { ...this.state.pendingMerges }
      delete pendingMerges[sessionId]
      this.commit({ ...this.state, pendingMerges })
    })
  }

  /** Toggle one node in the context tray; additions restore creation-time order. */
  toggleContext(nodeId: TurnNodeId): void {
    this.run(() => {
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
    })
  }

  /** Remove all nodes from the next-request tray. */
  clearContext(): void {
    this.run(() => { this.commit({ ...this.state, contextManifest: [] }) })
  }

  /** Move one selected node before another selected node. */
  moveContext(nodeId: TurnNodeId, beforeId: TurnNodeId): void {
    this.run(() => {
      if (nodeId === beforeId) return
      const next = this.state.contextManifest.filter(id => id !== nodeId)
      const index = next.indexOf(beforeId)
      if (index < 0 || !this.state.contextManifest.includes(nodeId)) return
      next.splice(index, 0, nodeId)
      this.commit({ ...this.state, contextManifest: next })
    })
  }

  /** Move one selected node to the end of the tray. */
  moveContextToEnd(nodeId: TurnNodeId): void {
    this.run(() => {
      if (!this.state.contextManifest.includes(nodeId)) return
      this.commit({
        ...this.state,
        contextManifest: [...this.state.contextManifest.filter(id => id !== nodeId), nodeId],
      })
    })
  }

  /** Change only the preview selection. */
  preview(nodeId: TurnNodeId): void {
    this.run(() => {
      if (this.state.nodes[nodeId] !== undefined) this.commit({ ...this.state, previewNodeId: nodeId })
    })
  }

  /** Rename a branch in the graph ledger. */
  renameBranch(branchId: BranchId, name: string): void {
    this.run(() => {
      const branch = this.state.branches[branchId]
      const normalized = name.trim()
      if (branch === undefined || normalized === '') return
      this.commit({
        ...this.state,
        branches: { ...this.state.branches, [branchId]: { ...branch, name: normalized } },
      })
    })
  }
}
