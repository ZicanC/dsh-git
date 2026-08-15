/** Resolve one persistent conversation graph per Workspace folder. */
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { GraphTransport } from './graph-transport.ts'
import { GraphRepository } from './repository.ts'

/**
 * Owns isolated graph ledgers and resolves the ledger for each Session.
 *
 * A scope id is the Host record key, so it must stay stable across sessions and
 * browsers: `workspace:<id>` for a folder member, `session:<id>` for a Session
 * that belongs to no folder.
 */
export class WorkspaceGraphRepositories {
  private readonly repositories = new Map<string, GraphRepository>()
  private readonly pendingSessionScopes = new Map<string, string>()

  constructor(
    private readonly workspaces: Pick<IWorkspaces, 'list'>,
    private readonly transport?: GraphTransport,
  ) {}

  /** Return the ledger owned by exactly one Workspace folder. */
  forWorkspace(workspaceId: string): GraphRepository {
    return this.forScope(`workspace:${workspaceId}`)
  }

  /** Resolve a Session through current Workspace membership, never through a global ledger. */
  forSession(sessionId: string): GraphRepository {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(candidate => candidate.sessionIds.some((id: string) => id === sessionId))
    if (workspace !== undefined) {
      const scope = `workspace:${workspace.workspaceId}`
      this.pendingSessionScopes.set(sessionId, scope)
      return this.forScope(scope)
    }
    const pending = this.pendingSessionScopes.get(sessionId)
    return this.forScope(pending ?? `session:${sessionId}`)
  }

  /** Keep a newly-created branch in its source folder while membership frames arrive. */
  pinSession(sessionId: string, repository: GraphRepository): void {
    const entry = [...this.repositories.entries()].find(([, candidate]) => candidate === repository)
    if (entry !== undefined) this.pendingSessionScopes.set(sessionId, entry[0])
  }

  private forScope(scope: string): GraphRepository {
    const existing = this.repositories.get(scope)
    if (existing !== undefined) return existing
    const repository = new GraphRepository(this.transport, scope)
    this.repositories.set(scope, repository)
    // Callers resolve a repository synchronously from a React render path, so
    // the first load runs detached; the repository defers mutations until it lands.
    void repository.hydrate()
    return repository
  }
}
