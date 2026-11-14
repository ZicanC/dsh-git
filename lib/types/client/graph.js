import { identityOf } from "../graph-ledger.js";
/** Freeze the history path independently from the physical node's owner. */
export function contextReferences(state, manifest, via = {}) {
    return manifest.map(id => {
        const node = state.nodes[id];
        if (node === undefined)
            throw new Error(`Missing selected PA: ${id}`);
        return { paId: identityOf(state, id), viaSessionId: via[id] ?? node.sessionId };
    });
}
export function resolveContextReferences(state, refs) {
    const identities = new Set();
    return refs.map(ref => {
        if (identities.has(ref.paId))
            throw new Error('Duplicate Context PA identity');
        identities.add(ref.paId);
        const matches = Object.values(state.sessionTurnRefs[ref.viaSessionId] ?? {})
            .filter(id => state.nodes[id] !== undefined && identityOf(state, id) === ref.paId);
        if (matches.length !== 1)
            throw new Error(`Invalid Context history reference: ${ref.viaSessionId}`);
        return matches[0];
    });
}
/** Return nodes in stable creation order with ids breaking timestamp ties. */
export function orderedNodes(state) {
    return Object.values(state.nodes).sort((left, right) => (left.finalOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.finalOrdinal ?? Number.MAX_SAFE_INTEGER)
        || left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}
/** Return the primary-parent ancestry from root through the addressed node. */
export function primaryPath(state, nodeId) {
    const reversed = [];
    const visited = new Set();
    let cursor = nodeId;
    while (cursor !== null && !visited.has(cursor)) {
        const node = state.nodes[cursor];
        if (node === undefined)
            break;
        visited.add(cursor);
        reversed.push(cursor);
        cursor = node.primaryParentId;
    }
    return reversed.reverse();
}
/** Return selected nodes whose primary parent is absent from the selection. */
export function missingDirectDependencies(state, manifest) {
    const selected = new Set(manifest);
    const missing = new Set();
    for (const id of manifest) {
        const parent = state.nodes[id]?.primaryParentId;
        if (parent !== null && parent !== undefined && !selected.has(parent))
            missing.add(parent);
    }
    return [...missing];
}
/**
 * Whether a selection joins lineages rather than continuing one.
 *
 * A selection drawn from a single Session — the current Chat's own history,
 * trimmed or reordered — branches that lineage: that is a Fork. Only PAs
 * pulled from a second Session make the new Chat a Merge.
 */
export function joinsLineages(state, manifest, refs) {
    if (refs !== undefined)
        return new Set(refs.map(ref => ref.viaSessionId)).size > 1;
    const sessions = new Set(normalizeContextOccurrences(state, manifest).flatMap((id) => {
        const node = state.nodes[id];
        return node === undefined ? [] : [node.sessionId];
    }));
    return sessions.size > 1;
}
/** Resolve every visual fork copy to the original PA identity it represents. */
export function paIdentityId(state, nodeId) {
    const visited = new Set();
    let cursor = nodeId;
    while (!visited.has(cursor)) {
        visited.add(cursor);
        const source = state.nodes[cursor]?.forkSourceId;
        if (source === undefined || state.nodes[source] === undefined)
            return cursor;
        cursor = source;
    }
    // Malformed cycles remain deterministic and are rejected by the durable
    // validation layer once occurrence identity becomes part of the schema.
    return [...visited].sort()[0] ?? nodeId;
}
/**
 * Keep one occurrence per PA identity without moving its original Tray slot.
 *
 * Selecting another fork copy replaces the occurrence stored in that slot;
 * it never adds a second copy of the same PA to the outgoing Context.
 */
export function normalizeContextOccurrences(state, manifest) {
    const entries = new Map();
    manifest.forEach((nodeId, index) => {
        if (state.nodes[nodeId] === undefined)
            return;
        const identityId = paIdentityId(state, nodeId);
        const existing = entries.get(identityId);
        entries.set(identityId, { nodeId, firstIndex: existing?.firstIndex ?? index });
    });
    return [...entries.values()]
        .sort((left, right) => left.firstIndex - right.firstIndex)
        .map(entry => entry.nodeId);
}
/**
 * Keep only the last selected PA from each source Session.
 *
 * The surviving endpoints retain the order of their own final Tray positions,
 * rather than the order in which their Sessions first appeared. The final
 * surviving endpoint is therefore also the layout-primary parent.
 */
export function lineageParentPlan(state, manifest, refs) {
    const terminalBySession = new Map();
    const occurrences = refs === undefined ? normalizeContextOccurrences(state, manifest) : resolveContextReferences(state, refs);
    occurrences.forEach((nodeId, index) => {
        const node = state.nodes[nodeId];
        if (node !== undefined)
            terminalBySession.set(refs?.[index]?.viaSessionId ?? node.sessionId, { nodeId, index });
    });
    const parentIds = [...terminalBySession.values()]
        .sort((left, right) => left.index - right.index)
        .map(entry => entry.nodeId);
    return { parentIds, primaryParentId: parentIds.at(-1) ?? null };
}
/** Assign stable lanes and parent edges for a compact GitLens-style graph. */
export function layoutGraph(state) {
    const nodes = orderedNodes(state);
    const childCount = new Map();
    const lanes = new Map();
    const positions = [];
    const edges = [];
    let nextLane = 0;
    for (const [row, node] of nodes.entries()) {
        let lane;
        if (node.primaryParentId === null) {
            lane = nextLane++;
        }
        else {
            const parentLane = lanes.get(node.primaryParentId);
            const siblings = childCount.get(node.primaryParentId) ?? 0;
            lane = parentLane !== undefined && siblings === 0 ? parentLane : nextLane++;
            childCount.set(node.primaryParentId, siblings + 1);
        }
        lanes.set(node.id, lane);
        positions.push({ nodeId: node.id, row, lane });
        for (const parentId of node.parentIds) {
            if (state.nodes[parentId] === undefined)
                continue;
            edges.push({ parentId, childId: node.id, merge: parentId !== node.primaryParentId });
        }
    }
    return { positions, edges, laneCount: Math.max(1, nextLane) };
}
/** Estimate prompt tokens without coupling the browser plugin to a tokenizer. */
export function estimateTokens(state, manifest) {
    const characters = manifest.reduce((total, id) => {
        const node = state.nodes[id];
        return total + (node === undefined ? 0 : node.prompt.length + node.answer.length);
    }, 0);
    return Math.ceil(characters / 4);
}
//# sourceMappingURL=graph.js.map