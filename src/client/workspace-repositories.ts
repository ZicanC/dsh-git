/** Resolve one persistent conversation graph per Workspace folder. */
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import { GraphRepository } from './repository.ts'
import type { GraphState, TurnNodeId } from './types.ts'

interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Owns isolated graph ledgers and resolves the ledger for each Session. */
export class WorkspaceGraphRepositories {
  private readonly repositories = new Map<string, GraphRepository>()
  private readonly pendingSessionScopes = new Map<string, string>()
  private readonly legacyState: GraphState

  constructor(
    private readonly workspaces: Pick<IWorkspaces, 'list'>,
    private readonly storage?: BrowserStorage,
  ) {
    this.legacyState = new GraphRepository(storage).getSnapshot()
  }

  /** Return the ledger owned by exactly one Workspace folder. */
  forWorkspace(workspaceId: string): GraphRepository {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(candidate => candidate.workspaceId === workspaceId)
    return this.forScope(`workspace:${workspaceId}`, workspace?.sessionIds.map(String) ?? [])
  }

  /** Resolve a Session through current Workspace membership, never through a global ledger. */
  forSession(sessionId: string): GraphRepository {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(candidate => candidate.sessionIds.some((id: string) => id === sessionId))
    if (workspace !== undefined) {
      const scope = `workspace:${workspace.workspaceId}`
      this.pendingSessionScopes.set(sessionId, scope)
      return this.forScope(scope, workspace.sessionIds.map(String))
    }
    const pending = this.pendingSessionScopes.get(sessionId)
    return this.forScope(pending ?? `session:${sessionId}`, [sessionId])
  }

  /** Keep a newly-created branch in its source folder while membership frames arrive. */
  pinSession(sessionId: string, repository: GraphRepository): void {
    const entry = [...this.repositories.entries()].find(([, candidate]) => candidate === repository)
    if (entry !== undefined) this.pendingSessionScopes.set(sessionId, entry[0])
  }

  private forScope(scope: string, sessionIds: readonly string[] = []): GraphRepository {
    const existing = this.repositories.get(scope)
    if (existing !== undefined) return existing
    const repository = new GraphRepository(
      this.storage,
      scope,
      graphStateForSessions(this.legacyState, sessionIds),
    )
    this.repositories.set(scope, repository)
    return repository
  }
}

/** Partition the old global ledger without retaining cross-folder nodes or edges. */
export function graphStateForSessions(state: GraphState, sessionIds: readonly string[]): GraphState {
  const sessions = new Set(sessionIds)
  const nodeIds = new Set(Object.values(state.nodes)
    .filter(node => sessions.has(node.sessionId))
    .map(node => node.id))
  const keepId = (id: TurnNodeId): boolean => nodeIds.has(id)
  const nodes = Object.fromEntries(Object.entries(state.nodes).flatMap(([id, node]) =>
    keepId(id) ? [[id, {
      ...node,
      parentIds: node.parentIds.filter(keepId),
      primaryParentId: node.primaryParentId !== null && keepId(node.primaryParentId)
        ? node.primaryParentId
        : null,
      contextManifest: node.contextManifest.filter(keepId),
    }]] : []))
  const branches = Object.fromEntries(Object.entries(state.branches).flatMap(([id, branch]) =>
    sessions.has(branch.sessionId) ? [[id, {
      ...branch,
      headId: branch.headId !== null && keepId(branch.headId) ? branch.headId : null,
    }]] : []))
  const branchIds = new Set(Object.keys(branches))
  const sessionBranches = Object.fromEntries(Object.entries(state.sessionBranches)
    .filter(([sessionId, branchId]) => sessions.has(sessionId) && branchIds.has(branchId)))
  const sessionTurnRefs = Object.fromEntries(Object.entries(state.sessionTurnRefs).flatMap(([sessionId, refs]) =>
    sessions.has(sessionId)
      ? [[sessionId, Object.fromEntries(Object.entries(refs).filter(([, id]) => keepId(id)))]]
      : []))
  const pendingMerges = Object.fromEntries(Object.entries(state.pendingMerges).flatMap(([sessionId, merge]) =>
    sessions.has(sessionId) && branchIds.has(merge.branchId) ? [[sessionId, {
      ...merge,
      parentIds: merge.parentIds.filter(keepId),
      primaryParentId: merge.primaryParentId !== null && keepId(merge.primaryParentId)
        ? merge.primaryParentId
        : null,
      contextManifest: merge.contextManifest.filter(keepId),
    }]] : []))
  return {
    ...state,
    nodes,
    branches,
    sessionBranches,
    sessionTurnRefs,
    pendingMerges,
    headNodeId: state.headNodeId !== null && keepId(state.headNodeId) ? state.headNodeId : null,
    previewNodeId: state.previewNodeId !== null && keepId(state.previewNodeId) ? state.previewNodeId : null,
    contextManifest: state.contextManifest.filter(keepId),
  }
}
