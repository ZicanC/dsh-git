import type { GraphTransport } from './graph-transport.ts';
import type { BranchId, GraphState, ImportedTurn, PrepareBranchInput, TurnNodeId } from './types.ts';
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
export declare class GraphRepository {
    private readonly transport?;
    private readonly scopeId?;
    private state;
    private readonly listeners;
    private hydrated;
    private deferred;
    /**
     * @param transport - Host ledger access; omitted keeps an in-memory repository
     *   that is hydrated from the start (used by tests and by a Host that has not
     *   loaded the plugin's storage domain).
     * @param scopeId - the ledger's owning scope; omitted with a transport is invalid.
     */
    constructor(transport?: GraphTransport | undefined, scopeId?: string | undefined);
    /** Return the stable snapshot until the next mutation. */
    getSnapshot: () => GraphState;
    /** Subscribe to graph mutations. */
    subscribe: (listener: () => void) => (() => void);
    /** True once the Host ledger has landed and mutations apply immediately. */
    get ready(): boolean;
    /**
     * Load this scope's stored ledger once, then release any deferred mutations.
     *
     * A failed read still opens the gate: the graph rebuilds itself from the
     * session logs the browser is already displaying, which is a better outcome
     * than a permanently frozen tab.
     */
    hydrate(): Promise<void>;
    /** Apply one mutation now, or hold it until the Host ledger has landed. */
    private run;
    private commit;
    /** Import completed turns from the currently viewed DSH session. */
    syncSession(sessionId: string, turns: readonly ImportedTurn[]): void;
    private syncSessionNow;
    /** Collapse browser-imported copies from ordinary Host forks into one labeled fork point. */
    reconcileOfficialForks(parents: Readonly<Record<string, string>>): void;
    private reconcileOfficialForksNow;
    /** Record an auto-created child session before its first merged request completes. */
    prepareBranch(input: PrepareBranchInput): void;
    private prepareBranchNow;
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
