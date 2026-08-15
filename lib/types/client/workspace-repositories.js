import { GraphRepository } from "./repository.js";
/**
 * Owns isolated graph ledgers and resolves the ledger for each Session.
 *
 * A scope id is the Host record key, so it must stay stable across sessions and
 * browsers: `workspace:<id>` for a folder member, `session:<id>` for a Session
 * that belongs to no folder.
 */
export class WorkspaceGraphRepositories {
    workspaces;
    transport;
    repositories = new Map();
    pendingSessionScopes = new Map();
    constructor(workspaces, transport) {
        this.workspaces = workspaces;
        this.transport = transport;
    }
    /** Return the ledger owned by exactly one Workspace folder. */
    forWorkspace(workspaceId) {
        return this.forScope(`workspace:${workspaceId}`);
    }
    /** Resolve a Session through current Workspace membership, never through a global ledger. */
    forSession(sessionId) {
        const workspace = this.workspaces.list.getSnapshot().items
            .find(candidate => candidate.sessionIds.some((id) => id === sessionId));
        if (workspace !== undefined) {
            const scope = `workspace:${workspace.workspaceId}`;
            this.pendingSessionScopes.set(sessionId, scope);
            return this.forScope(scope);
        }
        const pending = this.pendingSessionScopes.get(sessionId);
        return this.forScope(pending ?? `session:${sessionId}`);
    }
    /** Keep a newly-created branch in its source folder while membership frames arrive. */
    pinSession(sessionId, repository) {
        const entry = [...this.repositories.entries()].find(([, candidate]) => candidate === repository);
        if (entry !== undefined)
            this.pendingSessionScopes.set(sessionId, entry[0]);
    }
    forScope(scope) {
        const existing = this.repositories.get(scope);
        if (existing !== undefined)
            return existing;
        const repository = new GraphRepository(this.transport, scope);
        this.repositories.set(scope, repository);
        // Callers resolve a repository synchronously from a React render path, so
        // the first load runs detached; the repository defers mutations until it lands.
        void repository.hydrate();
        return repository;
    }
}
//# sourceMappingURL=workspace-repositories.js.map