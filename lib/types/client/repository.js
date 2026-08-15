import { primaryPath } from "./graph.js";
import { EMPTY_GRAPH_STATE } from "./types.js";
const EMPTY_STATE = EMPTY_GRAPH_STATE;
function id(prefix) {
    const suffix = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${suffix}`;
}
function distinct(ids) {
    return [...new Set(ids)];
}
function officialForkNodeId(sessionId, turn) {
    return `fork-${encodeURIComponent(sessionId)}-${turn}`;
}
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
     * A failed read still opens the gate: the graph rebuilds itself from the
     * session logs the browser is already displaying, which is a better outcome
     * than a permanently frozen tab.
     */
    async hydrate() {
        if (this.hydrated || this.transport === undefined || this.scopeId === undefined)
            return;
        let loaded = EMPTY_STATE;
        try {
            loaded = await this.transport.read(this.scopeId);
        }
        finally {
            this.hydrated = true;
            this.state = loaded;
            const pending = this.deferred;
            this.deferred = [];
            for (const mutation of pending)
                mutation();
            for (const listener of this.listeners)
                listener();
        }
    }
    /** Apply one mutation now, or hold it until the Host ledger has landed. */
    run(mutation) {
        if (this.hydrated)
            mutation();
        else
            this.deferred.push(mutation);
    }
    commit(next) {
        this.state = next;
        if (this.transport !== undefined && this.scopeId !== undefined) {
            void this.transport.write(this.scopeId, next).catch(() => undefined);
        }
        for (const listener of this.listeners)
            listener();
    }
    /** Import completed turns from the currently viewed DSH session. */
    syncSession(sessionId, turns) {
        this.run(() => { this.syncSessionNow(sessionId, turns); });
    }
    syncSessionNow(sessionId, turns) {
        let next = this.state;
        const knownRefs = { ...(next.sessionTurnRefs[sessionId] ?? {}) };
        let branchId = next.sessionBranches[sessionId];
        if (branchId === undefined) {
            branchId = id('branch');
            next = {
                ...next,
                branches: {
                    ...next.branches,
                    [branchId]: {
                        id: branchId,
                        name: `branch-${Object.keys(next.branches).length + 1}`,
                        sessionId,
                        headId: null,
                        color: Object.keys(next.branches).length % 8,
                        createdAt: turns[0]?.createdAt ?? Date.now(),
                    },
                },
                sessionBranches: { ...next.sessionBranches, [sessionId]: branchId },
            };
        }
        let nodes = { ...next.nodes };
        let previousId = null;
        let pending = next.pendingMerges[sessionId];
        for (const turn of [...turns].sort((left, right) => left.turn - right.turn)) {
            const knownId = knownRefs[turn.turn];
            if (knownId !== undefined) {
                const known = nodes[knownId];
                if (known !== undefined && (known.prompt !== turn.prompt || known.answer !== turn.answer)) {
                    nodes[knownId] = { ...known, prompt: turn.prompt, answer: turn.answer };
                }
                previousId = knownId;
                continue;
            }
            const nodeId = id('pa');
            const merge = pending;
            const parentIds = merge === undefined
                ? previousId === null ? [] : [previousId]
                : distinct(merge.parentIds);
            const primaryParentId = merge?.primaryParentId ?? previousId;
            const node = {
                id: nodeId,
                sessionId,
                turn: turn.turn,
                prompt: merge?.prompt ?? turn.prompt,
                answer: turn.answer,
                createdAt: turn.createdAt,
                boundarySeq: turn.boundarySeq,
                primaryParentId,
                parentIds,
                contextManifest: merge?.contextManifest ?? primaryPath({ ...next, nodes }, primaryParentId),
                branchId,
            };
            nodes[nodeId] = node;
            knownRefs[turn.turn] = nodeId;
            previousId = nodeId;
            pending = undefined;
        }
        const headId = previousId;
        const branch = next.branches[branchId];
        const pendingMerges = { ...next.pendingMerges };
        if (next.pendingMerges[sessionId] !== undefined && pending === undefined)
            delete pendingMerges[sessionId];
        const shouldSeedTray = next.contextManifest.length === 0 && headId !== null;
        const final = {
            ...next,
            nodes,
            branches: branch === undefined ? next.branches : {
                ...next.branches,
                [branchId]: { ...branch, headId },
            },
            sessionTurnRefs: { ...next.sessionTurnRefs, [sessionId]: knownRefs },
            pendingMerges,
            headNodeId: headId,
            previewNodeId: next.previewNodeId ?? headId,
            contextManifest: shouldSeedTray ? primaryPath({ ...next, nodes }, headId) : next.contextManifest,
        };
        if (JSON.stringify(final) !== JSON.stringify(this.state))
            this.commit(final);
    }
    /** Collapse browser-imported copies from ordinary Host forks into one labeled fork point. */
    reconcileOfficialForks(parents) {
        this.run(() => { this.reconcileOfficialForksNow(parents); });
    }
    reconcileOfficialForksNow(parents) {
        let next = this.state;
        for (const [childSessionId, parentSessionId] of Object.entries(parents)) {
            if (childSessionId.startsWith('dsh-git-'))
                continue;
            const childRefs = next.sessionTurnRefs[childSessionId];
            const parentRefs = next.sessionTurnRefs[parentSessionId];
            if (childRefs === undefined || parentRefs === undefined)
                continue;
            const prefix = [];
            for (const [rawTurn, childId] of Object.entries(childRefs).sort(([left], [right]) => Number(left) - Number(right))) {
                const turn = Number(rawTurn);
                const sourceId = parentRefs[turn];
                if (sourceId === undefined)
                    break;
                const child = next.nodes[childId];
                const source = next.nodes[sourceId];
                if (child === undefined || source === undefined
                    || child.prompt !== source.prompt || child.answer !== source.answer)
                    break;
                prefix.push({ turn, childId, sourceId });
            }
            const tip = prefix.at(-1);
            if (tip === undefined)
                continue;
            const branchId = next.sessionBranches[childSessionId];
            const branch = branchId === undefined ? undefined : next.branches[branchId];
            if (branchId === undefined || branch === undefined)
                continue;
            const markerId = officialForkNodeId(childSessionId, tip.turn);
            const sourceTip = next.nodes[tip.sourceId];
            const remaining = Object.entries(childRefs)
                .map(([turn, nodeId]) => ({ turn: Number(turn), nodeId }))
                .filter(entry => entry.turn > tip.turn)
                .sort((left, right) => left.turn - right.turn);
            const firstOwnCreatedAt = next.nodes[remaining[0]?.nodeId ?? '']?.createdAt;
            const markerCreatedAt = firstOwnCreatedAt === undefined
                ? sourceTip.createdAt + 0.001
                : Math.max(sourceTip.createdAt + 0.001, firstOwnCreatedAt - 0.001);
            const marker = {
                ...sourceTip,
                id: markerId,
                sessionId: childSessionId,
                turn: tip.turn,
                createdAt: markerCreatedAt,
                branchId,
                forkSourceId: tip.sourceId,
            };
            const refs = {};
            const replacements = new Map();
            for (const entry of prefix.slice(0, -1)) {
                refs[entry.turn] = entry.sourceId;
                replacements.set(entry.childId, entry.sourceId);
            }
            refs[tip.turn] = markerId;
            replacements.set(tip.childId, markerId);
            let nodes = { ...next.nodes, [markerId]: marker };
            let previousId = markerId;
            for (const entry of remaining) {
                const node = nodes[entry.nodeId];
                if (node === undefined)
                    continue;
                refs[entry.turn] = entry.nodeId;
                nodes[entry.nodeId] = {
                    ...node,
                    primaryParentId: previousId,
                    parentIds: [previousId],
                    contextManifest: primaryPath({ ...next, nodes }, previousId),
                };
                previousId = entry.nodeId;
            }
            for (const entry of prefix) {
                if (entry.childId === entry.sourceId || entry.childId === markerId)
                    continue;
                if (nodes[entry.childId]?.sessionId === childSessionId)
                    delete nodes[entry.childId];
            }
            const replace = (nodeId) => replacements.get(nodeId) ?? nodeId;
            nodes = Object.fromEntries(Object.entries(nodes).map(([nodeId, node]) => [nodeId, {
                    ...node,
                    primaryParentId: node.primaryParentId === null ? null : replace(node.primaryParentId),
                    parentIds: distinct(node.parentIds.map(replace)),
                    contextManifest: distinct(node.contextManifest.map(replace)),
                }]));
            const contextManifest = distinct(next.contextManifest.map(replace)).filter(nodeId => nodes[nodeId] !== undefined);
            next = {
                ...next,
                nodes,
                branches: { ...next.branches, [branchId]: { ...branch, headId: previousId } },
                sessionTurnRefs: { ...next.sessionTurnRefs, [childSessionId]: refs },
                headNodeId: next.headNodeId === null ? null : replace(next.headNodeId),
                previewNodeId: next.previewNodeId === null ? null : replace(next.previewNodeId),
                contextManifest,
            };
        }
        if (JSON.stringify(next) !== JSON.stringify(this.state))
            this.commit(next);
    }
    /** Record an auto-created child session before its first merged request completes. */
    prepareBranch(input) {
        this.run(() => { this.prepareBranchNow(input); });
    }
    prepareBranchNow(input) {
        const inherited = {};
        for (const [index, nodeId] of distinct(input.importedNodeIds).entries()) {
            if (this.state.nodes[nodeId] !== undefined)
                inherited[index + 1] = nodeId;
        }
        const branchId = id('branch');
        this.commit({
            ...this.state,
            branches: {
                ...this.state.branches,
                [branchId]: {
                    id: branchId,
                    name: `merge-${Object.keys(this.state.branches).length + 1}`,
                    sessionId: input.childSessionId,
                    headId: input.baseNodeId,
                    color: Object.keys(this.state.branches).length % 8,
                    createdAt: Date.now(),
                },
            },
            sessionBranches: { ...this.state.sessionBranches, [input.childSessionId]: branchId },
            sessionTurnRefs: { ...this.state.sessionTurnRefs, [input.childSessionId]: inherited },
            pendingMerges: {
                ...this.state.pendingMerges,
                [input.childSessionId]: {
                    branchId,
                    parentIds: distinct(input.parentIds),
                    primaryParentId: input.primaryParentId,
                    contextManifest: [...input.contextManifest],
                    prompt: input.prompt,
                },
            },
            headNodeId: input.baseNodeId,
        });
    }
    /** Remove a pending merge after a rejected prompt. */
    abortPending(sessionId) {
        this.run(() => {
            if (this.state.pendingMerges[sessionId] === undefined)
                return;
            const pendingMerges = { ...this.state.pendingMerges };
            delete pendingMerges[sessionId];
            this.commit({ ...this.state, pendingMerges });
        });
    }
    /** Toggle one node in the context tray; additions restore creation-time order. */
    toggleContext(nodeId) {
        this.run(() => {
            if (this.state.nodes[nodeId] === undefined)
                return;
            const selected = new Set(this.state.contextManifest);
            if (selected.has(nodeId)) {
                selected.delete(nodeId);
                this.commit({ ...this.state, contextManifest: this.state.contextManifest.filter(id => selected.has(id)) });
                return;
            }
            const currentlyChronological = this.state.contextManifest.every((id, index, values) => index === 0
                || this.state.nodes[values[index - 1]].createdAt <= this.state.nodes[id].createdAt);
            const contextManifest = currentlyChronological
                ? [...selected, nodeId].sort((left, right) => this.state.nodes[left].createdAt - this.state.nodes[right].createdAt)
                : [...this.state.contextManifest, nodeId];
            this.commit({ ...this.state, contextManifest });
        });
    }
    /** Remove all nodes from the next-request tray. */
    clearContext() {
        this.run(() => { this.commit({ ...this.state, contextManifest: [] }); });
    }
    /** Move one selected node before another selected node. */
    moveContext(nodeId, beforeId) {
        this.run(() => {
            if (nodeId === beforeId)
                return;
            const next = this.state.contextManifest.filter(id => id !== nodeId);
            const index = next.indexOf(beforeId);
            if (index < 0 || !this.state.contextManifest.includes(nodeId))
                return;
            next.splice(index, 0, nodeId);
            this.commit({ ...this.state, contextManifest: next });
        });
    }
    /** Move one selected node to the end of the tray. */
    moveContextToEnd(nodeId) {
        this.run(() => {
            if (!this.state.contextManifest.includes(nodeId))
                return;
            this.commit({
                ...this.state,
                contextManifest: [...this.state.contextManifest.filter(id => id !== nodeId), nodeId],
            });
        });
    }
    /** Change only the preview selection. */
    preview(nodeId) {
        this.run(() => {
            if (this.state.nodes[nodeId] !== undefined)
                this.commit({ ...this.state, previewNodeId: nodeId });
        });
    }
    /** Rename a branch in the graph ledger. */
    renameBranch(branchId, name) {
        this.run(() => {
            const branch = this.state.branches[branchId];
            const normalized = name.trim();
            if (branch === undefined || normalized === '')
                return;
            this.commit({
                ...this.state,
                branches: { ...this.state.branches, [branchId]: { ...branch, name: normalized } },
            });
        });
    }
}
//# sourceMappingURL=repository.js.map