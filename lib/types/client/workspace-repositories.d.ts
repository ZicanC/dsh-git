/** Resolve one persistent conversation graph per Workspace folder. */
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client';
import { GraphRepository } from './repository.ts';
import type { GraphState } from './types.ts';
interface BrowserStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/** Owns isolated graph ledgers and resolves the ledger for each Session. */
export declare class WorkspaceGraphRepositories {
    private readonly workspaces;
    private readonly storage?;
    private readonly repositories;
    private readonly pendingSessionScopes;
    private readonly legacyState;
    constructor(workspaces: Pick<IWorkspaces, 'list'>, storage?: BrowserStorage | undefined);
    /** Return the ledger owned by exactly one Workspace folder. */
    forWorkspace(workspaceId: string): GraphRepository;
    /** Resolve a Session through current Workspace membership, never through a global ledger. */
    forSession(sessionId: string): GraphRepository;
    /** Keep a newly-created branch in its source folder while membership frames arrive. */
    pinSession(sessionId: string, repository: GraphRepository): void;
    private forScope;
}
/** Partition the old global ledger without retaining cross-folder nodes or edges. */
export declare function graphStateForSessions(state: GraphState, sessionIds: readonly string[]): GraphState;
export {};
