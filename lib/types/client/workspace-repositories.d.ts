/** Resolve one persistent conversation graph per Workspace folder. */
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client';
import type { GraphTransport } from './graph-transport.ts';
import { GraphRepository } from './repository.ts';
/**
 * Owns isolated graph ledgers and resolves the ledger for each Session.
 *
 * A scope id is the Host record key, so it must stay stable across sessions and
 * browsers: `workspace:<id>` for a folder member, `session:<id>` for a Session
 * that belongs to no folder.
 */
export declare class WorkspaceGraphRepositories {
    private readonly workspaces;
    private readonly transport?;
    private readonly repositories;
    private readonly pendingSessionScopes;
    constructor(workspaces: Pick<IWorkspaces, 'list'>, transport?: GraphTransport | undefined);
    /** Return the ledger owned by exactly one Workspace folder. */
    forWorkspace(workspaceId: string): GraphRepository;
    /** Resolve a Session through current Workspace membership, never through a global ledger. */
    forSession(sessionId: string): GraphRepository;
    /** Keep a newly-created branch in its source folder while membership frames arrive. */
    pinSession(sessionId: string, repository: GraphRepository): void;
    private forScope;
}
