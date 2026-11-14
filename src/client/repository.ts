import { finalizeGraph, repairOccurrences } from '../graph-ledger.ts'
import { paIdentityId } from './graph.ts'
import type { GraphTransport } from './graph-transport.ts'
import {
  adoptObservedGraph, prepareMergedSession, reconcileOfficialForks, syncSessionTurns,
} from './ledger-transitions.ts'
import { EMPTY_GRAPH_STATE } from './types.ts'
import type {
  AnchorModeState, BranchId, GraphState, ImportedTurn, PrepareMergedSessionInput, TurnNodeId,
} from './types.ts'

const EMPTY_STATE = EMPTY_GRAPH_STATE

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
  private hydration: Promise<void> | undefined
  private writeError: Error | null = null
  private writeGeneration = 0

  get persistenceError(): Error | null { return this.writeError }
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
   * Failed reads keep the gate closed. A later retry hydrates the stored graph
   * before replaying deferred observations, so a transient outage cannot erase it.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated || this.transport === undefined || this.scopeId === undefined) return
    if (this.hydration !== undefined) return this.hydration
    this.hydration = this.transport.read(this.scopeId).then(loaded => {
      // Ledgers stored before one-occurrence-per-Session was enforced are
      // repaired here; left alone, the Host would refuse every later write.
      this.state = finalizeGraph(repairOccurrences(loaded))
      this.hydrated = true
      this.writeError = null
      const pending = this.deferred
      this.deferred = []
      for (const mutation of pending) mutation()
      for (const listener of this.listeners) listener()
    }).catch((error: unknown) => {
      this.writeError = error instanceof Error ? error : new Error(String(error))
      this.state = { ...this.state }
      // Keep both the persisted ledger and deferred mutations intact for retry.
      for (const listener of this.listeners) listener()
      throw error
    }).finally(() => { this.hydration = undefined })
    return this.hydration
  }

  /** Apply one mutation now, or hold it until the Host ledger has landed. */
  private run(mutation: () => void): void {
    if (this.hydrated) mutation()
    else this.deferred.push(mutation)
  }

  private commit(next: GraphState): void {
    next = finalizeGraph(next)
    this.state = next
    if (this.transport !== undefined && this.scopeId !== undefined) {
      const generation = ++this.writeGeneration
      void this.transport.write(this.scopeId, next).then(() => {
        if (generation !== this.writeGeneration || this.writeError === null) return
        this.writeError = null
        this.state = { ...this.state }
        for (const listener of this.listeners) listener()
      }).catch((error: unknown) => {
        if (generation !== this.writeGeneration) return
        this.writeError = error instanceof Error ? error : new Error(String(error))
        this.state = { ...this.state }
        for (const listener of this.listeners) listener()
      })
    }
    for (const listener of this.listeners) listener()
  }

  /**
   * Import completed turns from the currently viewed DSH session.
   *
   * `parents` maps each official Harness fork to the Session it was forked
   * from. The import and the fork reconciliation land as one commit, so the
   * prefix a fork copied from its parent is recognised before it is numbered:
   * a copy never spends a PA number of its own.
   */
  syncSession(
    sessionId: string,
    turns: readonly ImportedTurn[],
    parents: Readonly<Record<string, string>> = {},
  ): void {
    this.run(() => {
      const next = reconcileOfficialForks(syncSessionTurns(this.state, sessionId, turns), parents)
      if (JSON.stringify(next) !== JSON.stringify(this.state)) this.commit(next)
    })
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
      const next = adoptObservedGraph(this.state, observed)
      if (JSON.stringify(next) !== JSON.stringify(this.state)) this.commit(next)
    })
  }

  /** Collapse browser-imported copies from ordinary Host forks into one labeled fork point. */
  reconcileOfficialForks(parents: Readonly<Record<string, string>>): void {
    this.run(() => {
      const next = reconcileOfficialForks(this.state, parents)
      if (JSON.stringify(next) !== JSON.stringify(this.state)) this.commit(next)
    })
  }

  /** Register a merged child Session before its first new official turn. */
  prepareMergedSession(input: PrepareMergedSessionInput): void {
    this.run(() => { this.commit(prepareMergedSession(this.state, input)) })
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

  /** Freeze one source Session's selected context into an Anchor Workspace. */
  activateAnchor(sessionId: string, anchor: AnchorModeState): void {
    this.run(() => {
      const nodeIds = [...new Set(anchor.nodeIds)]
      if (anchor.sourceSessionId !== sessionId
        || nodeIds.length === 0
        || nodeIds.some(nodeId => this.state.nodes[nodeId] === undefined)) return
      this.commit({
        ...this.state,
        anchors: { ...this.state.anchors, [sessionId]: { ...anchor, nodeIds } },
      })
    })
  }

  /** Leave anchor mode after the Host has cleaned up any unused Workspace. */
  cancelAnchor(sessionId: string): void {
    this.run(() => {
      if (this.state.anchors[sessionId] === undefined) return
      const anchors = { ...this.state.anchors }
      delete anchors[sessionId]
      this.commit({ ...this.state, anchors })
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
      const equivalent = this.state.contextManifest.find(id => paIdentityId(this.state, id) === paIdentityId(this.state, nodeId))
      if (equivalent !== undefined) {
        this.commit({ ...this.state, contextManifest: this.state.contextManifest.map(id => id === equivalent ? nodeId : id) })
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
