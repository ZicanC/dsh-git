import type { GraphTransport } from './graph-transport.ts';
import type { AnchorModeState, GraphState, ImportedTurn, PrepareMergedSessionInput } from './types.ts';
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
    private hydration;
    private writeError;
    private writeGeneration;
    get persistenceError(): Error | null;
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
     * Failed reads keep the gate closed. A later retry hydrates the stored graph
     * before replaying deferred observations, so a transient outage cannot erase it.
     */
    hydrate(): Promise<void>;
    /** Apply one mutation now, or hold it until the Host ledger has landed. */
    private run;
    private commit;
    /**
     * Import completed turns from the currently viewed DSH session.
     *
     * `parents` maps each official Harness fork to the Session it was forked
     * from. The import and the fork reconciliation land as one commit, so the
     * prefix a fork copied from its parent is recognised before it is numbered:
     * a copy never spends a PA number of its own.
     */
    syncSession(sessionId: string, turns: readonly ImportedTurn[], parents?: Readonly<Record<string, string>>): void;
    /**
     * Adopt a complete Host-observed Workspace graph without replacing local
     * branch names, pending merge metadata, or transient view state.
     *
     * Project assembly reuses every known browser id before minting fallback
     * ids, so this union also makes previously unopened Session turns available
     * to a later merged child without duplicating them in the ledger.
     */
    adoptObservedGraph(observed: GraphState): void;
    /** Collapse browser-imported copies from ordinary Host forks into one labeled fork point. */
    reconcileOfficialForks(parents: Readonly<Record<string, string>>): void;
    /** Register a merged child Session before its first new official turn. */
    prepareMergedSession(input: PrepareMergedSessionInput): void;
    /** Freeze one source Session's selected context into an Anchor Workspace. */
    activateAnchor(sessionId: string, anchor: AnchorModeState): void;
    /** Leave anchor mode after the Host has cleaned up any unused Workspace. */
    cancelAnchor(sessionId: string): void;
}
