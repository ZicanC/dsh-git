import { finalizeGraph, repairOccurrences } from "../graph-ledger.js";
import { adoptObservedGraph, prepareMergedSession, reconcileOfficialForks, syncSessionTurns, } from "./ledger-transitions.js";
import { EMPTY_GRAPH_STATE } from "./types.js";
const EMPTY_STATE = EMPTY_GRAPH_STATE;
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
    transport;
    scopeId;
    state = EMPTY_STATE;
    listeners = new Set();
    hydrated = false;
    hydration;
    writeError = null;
    writeGeneration = 0;
    get persistenceError() { return this.writeError; }
    deferred = [];
    /**
     * @param transport - Host ledger access; omitted keeps an in-memory repository
     *   that is hydrated from the start (used by tests and by a Host that has not
     *   loaded the plugin's storage domain).
     * @param scopeId - the ledger's owning scope; omitted with a transport is invalid.
     */
    constructor(transport, scopeId) {
        this.transport = transport;
        this.scopeId = scopeId;
        this.hydrated = transport === undefined || scopeId === undefined;
    }
    /** Return the stable snapshot until the next mutation. */
    getSnapshot = () => this.state;
    /** Subscribe to graph mutations. */
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    /** True once the Host ledger has landed and mutations apply immediately. */
    get ready() { return this.hydrated; }
    /**
     * Load this scope's stored ledger once, then release any deferred mutations.
     *
     * Failed reads keep the gate closed. A later retry hydrates the stored graph
     * before replaying deferred observations, so a transient outage cannot erase it.
     */
    async hydrate() {
        if (this.hydrated || this.transport === undefined || this.scopeId === undefined)
            return;
        if (this.hydration !== undefined)
            return this.hydration;
        this.hydration = this.transport.read(this.scopeId).then(loaded => {
            // Ledgers stored before one-occurrence-per-Session was enforced are
            // repaired here; left alone, the Host would refuse every later write.
            this.state = finalizeGraph(repairOccurrences(loaded));
            this.hydrated = true;
            this.writeError = null;
            const pending = this.deferred;
            this.deferred = [];
            for (const mutation of pending)
                mutation();
            for (const listener of this.listeners)
                listener();
        }).catch((error) => {
            this.writeError = error instanceof Error ? error : new Error(String(error));
            this.state = { ...this.state };
            // Keep both the persisted ledger and deferred mutations intact for retry.
            for (const listener of this.listeners)
                listener();
            throw error;
        }).finally(() => { this.hydration = undefined; });
        return this.hydration;
    }
    /** Apply one mutation now, or hold it until the Host ledger has landed. */
    run(mutation) {
        if (this.hydrated)
            mutation();
        else
            this.deferred.push(mutation);
    }
    commit(next) {
        next = finalizeGraph(next);
        this.state = next;
        if (this.transport !== undefined && this.scopeId !== undefined) {
            const generation = ++this.writeGeneration;
            void this.transport.write(this.scopeId, next).then(() => {
                if (generation !== this.writeGeneration || this.writeError === null)
                    return;
                this.writeError = null;
                this.state = { ...this.state };
                for (const listener of this.listeners)
                    listener();
            }).catch((error) => {
                if (generation !== this.writeGeneration)
                    return;
                this.writeError = error instanceof Error ? error : new Error(String(error));
                this.state = { ...this.state };
                for (const listener of this.listeners)
                    listener();
            });
        }
        for (const listener of this.listeners)
            listener();
    }
    /**
     * Import completed turns from the currently viewed DSH session.
     *
     * `parents` maps each official Harness fork to the Session it was forked
     * from. The import and the fork reconciliation land as one commit, so the
     * prefix a fork copied from its parent is recognised before it is numbered:
     * a copy never spends a PA number of its own.
     */
    syncSession(sessionId, turns, parents = {}) {
        this.run(() => {
            const next = reconcileOfficialForks(syncSessionTurns(this.state, sessionId, turns), parents);
            if (JSON.stringify(next) !== JSON.stringify(this.state))
                this.commit(next);
        });
    }
    /**
     * Adopt a complete Host-observed Workspace graph without replacing local
     * branch names, pending merge metadata, or transient view state.
     *
     * Project assembly reuses every known browser id before minting fallback
     * ids, so this union also makes previously unopened Session turns available
     * to a later merged child without duplicating them in the ledger.
     */
    adoptObservedGraph(observed) {
        this.run(() => {
            const next = adoptObservedGraph(this.state, observed);
            if (JSON.stringify(next) !== JSON.stringify(this.state))
                this.commit(next);
        });
    }
    /** Collapse browser-imported copies from ordinary Host forks into one labeled fork point. */
    reconcileOfficialForks(parents) {
        this.run(() => {
            const next = reconcileOfficialForks(this.state, parents);
            if (JSON.stringify(next) !== JSON.stringify(this.state))
                this.commit(next);
        });
    }
    /** Register a merged child Session before its first new official turn. */
    prepareMergedSession(input) {
        this.run(() => { this.commit(prepareMergedSession(this.state, input)); });
    }
    /** Freeze one source Session's selected context into an Anchor Workspace. */
    activateAnchor(sessionId, anchor) {
        this.run(() => {
            const nodeIds = [...new Set(anchor.nodeIds)];
            if (anchor.sourceSessionId !== sessionId
                || nodeIds.length === 0
                || nodeIds.some(nodeId => this.state.nodes[nodeId] === undefined))
                return;
            this.commit({
                ...this.state,
                anchors: { ...this.state.anchors, [sessionId]: { ...anchor, nodeIds } },
            });
        });
    }
    /** Leave anchor mode after the Host has cleaned up any unused Workspace. */
    cancelAnchor(sessionId) {
        this.run(() => {
            if (this.state.anchors[sessionId] === undefined)
                return;
            const anchors = { ...this.state.anchors };
            delete anchors[sessionId];
            this.commit({ ...this.state, anchors });
        });
    }
}
//# sourceMappingURL=repository.js.map