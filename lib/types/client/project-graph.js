/** Pure assembly of a complete Workspace history into one read-only PA DAG. */
import { primaryPath } from "./graph.js";
function deterministicNodeId(sessionId, turn) {
    return `project-pa:${encodeURIComponent(sessionId)}:${turn}`;
}
function branchId(sessionId) {
    return `project-branch:${encodeURIComponent(sessionId)}`;
}
function exactFingerprintCandidates(addresses, local) {
    const candidates = new Map();
    for (const { session, turn } of addresses) {
        if (turn.inherited)
            continue;
        const localId = local.sessionTurnRefs[session.sessionId]?.[turn.turn];
        const id = localId !== undefined && local.nodes[localId] !== undefined
            ? localId
            : deterministicNodeId(session.sessionId, turn.turn);
        candidates.set(turn.fingerprint, [...(candidates.get(turn.fingerprint) ?? []), id]);
    }
    return candidates;
}
function titleOf(sessionId, titles) {
    return titles[sessionId]?.trim() || sessionId;
}
/** Assemble and deduplicate the project history without mutating the persistent graph repository. */
export function assembleProjectGraph(response, local, titles = {}) {
    const sessions = [...response.sessions].sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId));
    const addresses = sessions.flatMap(session => session.turns.map(turn => ({ session, turn })));
    const candidates = exactFingerprintCandidates(addresses, local);
    const canonical = new Map();
    const addressKey = (sessionId, turn) => `${sessionId}\u0000${turn}`;
    const sessionsById = new Map(sessions.map(session => [session.sessionId, session]));
    const resolving = new Set();
    const resolveCanonical = (session, turn) => {
        const key = addressKey(session.sessionId, turn.turn);
        const cached = canonical.get(key);
        if (cached !== undefined)
            return cached;
        const localId = local.sessionTurnRefs[session.sessionId]?.[turn.turn];
        if (localId !== undefined && local.nodes[localId] !== undefined) {
            canonical.set(key, localId);
            return localId;
        }
        // An ordinary Harness fork copies a contiguous prefix without renumbering
        // its turns. Prefer that explicit lineage over a Workspace-wide content
        // fingerprint, which can be ambiguous when several sessions contain the
        // same prompt and answer. The fingerprint guard prevents a composed merge
        // seed from being mistaken for the parent's same-numbered turn.
        if (turn.inherited && session.parentSessionId !== undefined && !resolving.has(key)) {
            const parent = sessionsById.get(session.parentSessionId);
            const parentTurn = parent?.turns.find(candidate => candidate.turn === turn.turn && candidate.fingerprint === turn.fingerprint);
            if (parent !== undefined && parentTurn !== undefined) {
                resolving.add(key);
                const parentId = resolveCanonical(parent, parentTurn);
                resolving.delete(key);
                canonical.set(key, parentId);
                return parentId;
            }
        }
        const matches = candidates.get(turn.fingerprint) ?? [];
        const id = turn.inherited && matches.length === 1
            ? matches[0]
            : deterministicNodeId(session.sessionId, turn.turn);
        canonical.set(key, id);
        return id;
    };
    for (const { session, turn } of addresses) {
        resolveCanonical(session, turn);
    }
    const nodes = {};
    const branches = {};
    const sessionBranches = {};
    const sessionTurnRefs = {};
    for (const session of sessions) {
        const sid = session.sessionId;
        const bid = branchId(sid);
        sessionBranches[sid] = bid;
        const refs = {};
        let previousId = null;
        let firstOwn = true;
        for (const turn of [...session.turns].sort((left, right) => left.turn - right.turn)) {
            const id = canonical.get(addressKey(sid, turn.turn));
            refs[turn.turn] = id;
            const localNode = local.nodes[id];
            const existing = nodes[id];
            if (existing === undefined) {
                const useLocalRelations = localNode !== undefined;
                const parentIds = useLocalRelations
                    ? localNode.parentIds.filter(parentId => local.nodes[parentId] !== undefined)
                    : previousId === null ? [] : [previousId];
                const primaryParentId = useLocalRelations ? localNode.primaryParentId : previousId;
                nodes[id] = {
                    id,
                    sessionId: localNode?.sessionId ?? sid,
                    turn: localNode?.turn ?? turn.turn,
                    prompt: localNode?.prompt ?? turn.prompt,
                    answer: localNode?.answer ?? turn.answer,
                    createdAt: localNode?.createdAt ?? turn.startedAt,
                    completedAt: turn.completedAt,
                    sessionCreatedAt: session.createdAt,
                    sessionTitle: titleOf(localNode?.sessionId ?? sid, titles),
                    firstInSession: !turn.inherited && firstOwn,
                    fingerprint: turn.fingerprint,
                    boundarySeq: localNode?.boundarySeq ?? turn.boundarySeq,
                    primaryParentId,
                    parentIds,
                    contextManifest: localNode?.contextManifest ?? (primaryParentId === null ? [] : [primaryParentId]),
                    branchId: localNode?.branchId ?? bid,
                };
            }
            if (!turn.inherited)
                firstOwn = false;
            previousId = id;
        }
        sessionTurnRefs[sid] = refs;
        const headId = session.turns.length === 0
            ? null
            : refs[session.turns.at(-1).turn] ?? null;
        branches[bid] = {
            id: bid,
            name: titleOf(sid, titles),
            sessionId: sid,
            headId,
            color: Object.keys(branches).length % 8,
            createdAt: session.createdAt,
        };
    }
    const provisional = {
        format: 1,
        nodes,
        branches,
        sessionBranches,
        sessionTurnRefs,
        pendingMerges: {},
        headNodeId: null,
        previewNodeId: null,
        contextManifest: [],
    };
    // Fill the simple fallback context with the complete primary ancestry after every node exists.
    for (const [id, node] of Object.entries(nodes)) {
        if (local.nodes[id] !== undefined)
            continue;
        nodes[id] = { ...node, contextManifest: primaryPath(provisional, node.primaryParentId) };
    }
    const timeline = Object.values(nodes)
        .sort((left, right) => left.completedAt - right.completedAt || left.id.localeCompare(right.id))
        .map(node => node.id);
    const headNodeId = timeline.at(-1) ?? null;
    return {
        state: { ...provisional, nodes, headNodeId, previewNodeId: headNodeId },
        nodes,
        timeline,
        sessionCount: sessions.length,
    };
}
/** Return the graph prefix visible at one one-based PA timeline position. */
export function projectGraphAt(model, count) {
    const visibleIds = new Set(model.timeline.slice(0, Math.max(1, Math.min(count, model.timeline.length))));
    const nodes = Object.fromEntries(Object.entries(model.state.nodes).flatMap(([id, node]) => visibleIds.has(id) ? [[id, {
                ...node,
                parentIds: node.parentIds.filter(parentId => visibleIds.has(parentId)),
                primaryParentId: node.primaryParentId !== null && visibleIds.has(node.primaryParentId)
                    ? node.primaryParentId
                    : null,
                contextManifest: node.contextManifest.filter(nodeId => visibleIds.has(nodeId)),
            }]] : []));
    const headNodeId = model.timeline[Math.max(0, Math.min(count, model.timeline.length) - 1)] ?? null;
    return { ...model.state, nodes, headNodeId, previewNodeId: null };
}
//# sourceMappingURL=project-graph.js.map