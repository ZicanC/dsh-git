import type { BranchId, GraphState, ImportedTurn, PrepareBranchInput, TurnNodeId } from './types.ts';
interface BrowserStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/** Persistent observable owning the browser-side conversation DAG. */
export declare class GraphRepository {
    private readonly storage?;
    private state;
    private readonly listeners;
    private readonly storageKey;
    /**
     * @param storage - browser storage; omitted keeps an in-memory repository.
     * @param scopeId - one Workspace-folder id; omitted preserves the standalone repository API.
     * @param fallbackState - one-time seed used only when the scoped key does not exist yet.
     */
    constructor(storage?: BrowserStorage | undefined, scopeId?: string, fallbackState?: GraphState);
    /** Return the stable snapshot until the next mutation. */
    getSnapshot: () => GraphState;
    /** Subscribe to graph mutations. */
    subscribe: (listener: () => void) => (() => void);
    private commit;
    /** Import completed turns from the currently viewed DSH session. */
    syncSession(sessionId: string, turns: readonly ImportedTurn[]): void;
    /** Collapse browser-imported copies from ordinary Host forks into one labeled fork point. */
    reconcileOfficialForks(parents: Readonly<Record<string, string>>): void;
    /** Record an auto-created child session before its first merged request completes. */
    prepareBranch(input: PrepareBranchInput): void;
    /** Remove a pending merge after a rejected prompt. */
    abortPending(sessionId: string): void;
    /** Toggle one node in the context tray; additions restore creation-time order. */
    toggleContext(nodeId: TurnNodeId): void;
    /** Remove all nodes from the next-request tray. */
    clearContext(): void;
    /** Move one selected node before another selected node. */
    moveContext(nodeId: TurnNodeId, beforeId: TurnNodeId): void;
    /** Move one selected node to the end of the tray. */
    moveContextToEnd(nodeId: TurnNodeId): void;
    /** Change only the preview selection. */
    preview(nodeId: TurnNodeId): void;
    /** Rename a branch in the graph ledger. */
    renameBranch(branchId: BranchId, name: string): void;
}
export {};
