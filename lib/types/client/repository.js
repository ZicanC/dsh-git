import { primaryPath } from "./graph.js";
const STORAGE_KEY = 'dsh-git.graph.v1';
function storageKey(scopeId) {
    return scopeId === undefined
        ? STORAGE_KEY
        : `${STORAGE_KEY}.workspace.${encodeURIComponent(scopeId)}`;
}
const EMPTY_STATE = {
    format: 1,
    nodes: {},
    branches: {},
    sessionBranches: {},
    sessionTurnRefs: {},
    pendingMerges: {},
    headNodeId: null,
    previewNodeId: null,
    contextManifest: [],
};
function id(prefix) {
    const suffix = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${suffix}`;
}
function distinct(ids) {
    return [...new Set(ids)];
}
function parseState(raw) {
    if (raw === null)
        return EMPTY_STATE;
    try {
        const value = JSON.parse(raw);
        if (value.format !== 1 || value.nodes === undefined || value.branches === undefined)
            return EMPTY_STATE;
        return {
            ...EMPTY_STATE,
            ...value,
            contextManifest: Array.isArray(value.contextManifest) ? value.contextManifest : [],
        };
    }
    catch {
        return EMPTY_STATE;
    }
}
/** Persistent observable owning the browser-side conversation DAG. */
export class GraphRepository {
    storage;
    state;
    listeners = new Set();
    storageKey;
    /**
     * @param storage - browser storage; omitted keeps an in-memory repository.
     * @param scopeId - one Workspace-folder id; omitted preserves the standalone repository API.
     * @param fallbackState - one-time seed used only when the scoped key does not exist yet.
     */
    constructor(storage, scopeId, fallbackState) {
        this.storage = storage;
        this.storageKey = storageKey(scopeId);
        const raw = storage?.getItem(this.storageKey) ?? null;
        this.state = raw === null && fallbackState !== undefined ? fallbackState : parseState(raw);
        if (raw === null && fallbackState !== undefined) {
            storage?.setItem(this.storageKey, JSON.stringify(fallbackState));
        }
    }
    /** Return the stable snapshot until the next mutation. */
    getSnapshot = () => this.state;
    /** Subscribe to graph mutations. */
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    commit(next) {
        this.state = next;
        this.storage?.setItem(this.storageKey, JSON.stringify(next));
        for (const listener of this.listeners)
            listener();
    }
    /** Import completed turns from the currently viewed DSH session. */
    syncSession(sessionId, turns) {
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
    /** Record an auto-created child session before its first merged request completes. */
    prepareBranch(input) {
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
        if (this.state.pendingMerges[sessionId] === undefined)
            return;
        const pendingMerges = { ...this.state.pendingMerges };
        delete pendingMerges[sessionId];
        this.commit({ ...this.state, pendingMerges });
    }
    /** Toggle one node in the context tray; additions restore creation-time order. */
    toggleContext(nodeId) {
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
    }
    /** Remove all nodes from the next-request tray. */
    clearContext() {
        this.commit({ ...this.state, contextManifest: [] });
    }
    /** Move one selected node before another selected node. */
    moveContext(nodeId, beforeId) {
        if (nodeId === beforeId)
            return;
        const next = this.state.contextManifest.filter(id => id !== nodeId);
        const index = next.indexOf(beforeId);
        if (index < 0 || !this.state.contextManifest.includes(nodeId))
            return;
        next.splice(index, 0, nodeId);
        this.commit({ ...this.state, contextManifest: next });
    }
    /** Move one selected node to the end of the tray. */
    moveContextToEnd(nodeId) {
        if (!this.state.contextManifest.includes(nodeId))
            return;
        this.commit({
            ...this.state,
            contextManifest: [...this.state.contextManifest.filter(id => id !== nodeId), nodeId],
        });
    }
    /** Change only the preview selection. */
    preview(nodeId) {
        if (this.state.nodes[nodeId] !== undefined)
            this.commit({ ...this.state, previewNodeId: nodeId });
    }
    /** Rename a branch in the graph ledger. */
    renameBranch(branchId, name) {
        const branch = this.state.branches[branchId];
        const normalized = name.trim();
        if (branch === undefined || normalized === '')
            return;
        this.commit({
            ...this.state,
            branches: { ...this.state.branches, [branchId]: { ...branch, name: normalized } },
        });
    }
}
//# sourceMappingURL=repository.js.map