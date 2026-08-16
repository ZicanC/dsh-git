/** Pure assembly of a complete Workspace history into one read-only PA DAG. */
import { primaryPath } from "./graph.js";
function localOnlyTurn(sessionId, turn, node) {
    return {
        turn,
        prompt: node.prompt,
        answer: node.answer,
        startedAt: node.createdAt,
        // The browser ledger records the turn start but not its completion time.
        // A local-only turn is necessarily newer than the frozen Host response, so
        // its start is the closest stable timeline coordinate available here.
        completedAt: node.createdAt,
        boundarySeq: node.boundarySeq,
        inherited: false,
        fingerprint: `local:${encodeURIComponent(sessionId)}:${turn}:${node.boundarySeq}`,
    };
}
/**
 * Overlay turns learned by the live conversation subscription onto the frozen
 * Workspace RPC snapshot. Addresses already present in the Host response stay
 * authoritative; only missing `(session, turn)` coordinates are appended.
 */
function sessionsWithLocalOnlyTurns(response, local) {
    const responseIds = new Set(response.sessions.map(session => session.sessionId));
    const sessions = response.sessions.map((session) => {
        const knownTurns = new Set(session.turns.map(turn => turn.turn));
        const additions = Object.entries(local.sessionTurnRefs[session.sessionId] ?? {})
            .map(([rawTurn, nodeId]) => ({ turn: Number(rawTurn), node: local.nodes[nodeId] }))
            .filter((entry) => Number.isSafeInteger(entry.turn) && entry.turn > 0
            && !knownTurns.has(entry.turn) && entry.node !== undefined)
            .map(({ turn, node }) => localOnlyTurn(session.sessionId, turn, node));
        return additions.length === 0
            ? session
            : { ...session, turns: [...session.turns, ...additions] };
    });
    for (const [sessionId, refs] of Object.entries(local.sessionTurnRefs)) {
        if (responseIds.has(sessionId))
            continue;
        const turns = Object.entries(refs)
            .map(([rawTurn, nodeId]) => ({ turn: Number(rawTurn), node: local.nodes[nodeId] }))
            .filter((entry) => Number.isSafeInteger(entry.turn) && entry.turn > 0 && entry.node !== undefined)
            .map(({ turn, node }) => localOnlyTurn(sessionId, turn, node));
        if (turns.length === 0)
            continue;
        const bid = local.sessionBranches[sessionId];
        const createdAt = (bid === undefined ? undefined : local.branches[bid]?.createdAt)
            ?? Math.min(...turns.map(turn => turn.startedAt));
        sessions.push({ sessionId, createdAt, seedLength: 0, turns });
    }
    return sessions;
}
function deterministicNodeId(sessionId, turn) {
    return `project-pa:${encodeURIComponent(sessionId)}:${turn}`;
}
function branchId(sessionId) {
    return `project-branch:${encodeURIComponent(sessionId)}`;
}
function forkNodeId(sessionId, turn) {
    return `project-fork:${encodeURIComponent(sessionId)}:${turn}`;
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
    const sessions = sessionsWithLocalOnlyTurns(response, local).sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId));
    const addresses = sessions.flatMap(session => session.turns.map(turn => ({ session, turn })));
    const candidates = exactFingerprintCandidates(addresses, local);
    const canonical = new Map();
    const addressKey = (sessionId, turn) => `${sessionId}\u0000${turn}`;
    const sessionsById = new Map(sessions.map(session => [session.sessionId, session]));
    const resolving = new Set();
    const ordinaryForkTips = new Map();
    for (const session of sessions) {
        // A dsh-git merge has exact per-turn provenance. Its parentSession is only
        // the Session used to create the child Agent and must never be interpreted
        // as an ordinary copied-prefix fork.
        if (session.mergeSources !== undefined)
            continue;
        if (session.parentSessionId === undefined)
            continue;
        const parent = sessionsById.get(session.parentSessionId);
        const inherited = session.turns.filter(turn => turn.inherited);
        if (parent === undefined || inherited.length === 0)
            continue;
        const isContiguousParentPrefix = inherited.every(turn => parent.turns.some(candidate => candidate.turn === turn.turn && candidate.fingerprint === turn.fingerprint));
        if (isContiguousParentPrefix)
            ordinaryForkTips.set(session.sessionId, inherited.at(-1).turn);
    }
    const resolveCanonical = (session, turn) => {
        const key = addressKey(session.sessionId, turn.turn);
        const cached = canonical.get(key);
        if (cached !== undefined)
            return cached;
        const localId = local.sessionTurnRefs[session.sessionId]?.[turn.turn];
        const mergeSource = session.mergeSources?.find(source => source.targetTurn === turn.turn);
        if (mergeSource !== undefined && !resolving.has(key)) {
            const sourceSession = sessionsById.get(mergeSource.sourceSessionId);
            const sourceTurn = sourceSession?.turns.find(candidate => candidate.turn === mergeSource.sourceTurn
                && candidate.boundarySeq === mergeSource.sourceBoundarySeq);
            if (sourceSession !== undefined && sourceTurn !== undefined) {
                resolving.add(key);
                const sourceId = resolveCanonical(sourceSession, sourceTurn);
                resolving.delete(key);
                canonical.set(key, sourceId);
                return sourceId;
            }
        }
        // A malformed or stale exact lineage coordinate must remain visibly
        // distinct. Falling through to fingerprint matching could silently replace
        // it with an identically worded PA from a different branch.
        if (session.mergeSources !== undefined && turn.inherited) {
            const id = deterministicNodeId(session.sessionId, turn.turn);
            canonical.set(key, id);
            return id;
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
                const id = ordinaryForkTips.get(session.sessionId) === turn.turn
                    ? forkNodeId(session.sessionId, turn.turn)
                    : parentId;
                canonical.set(key, id);
                return id;
            }
        }
        if (localId !== undefined && local.nodes[localId] !== undefined) {
            canonical.set(key, localId);
            return localId;
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
    const exactMergeRelationIds = new Set();
    for (const session of sessions) {
        const sid = session.sessionId;
        const bid = branchId(sid);
        sessionBranches[sid] = bid;
        const refs = {};
        let previousId = null;
        let firstOwn = true;
        const exactMergeParents = session.mergeSources === undefined
            ? []
            : [...new Set([...session.mergeSources]
                    .sort((left, right) => left.targetTurn - right.targetTurn)
                    .flatMap(source => canonical.get(addressKey(sid, source.targetTurn)) ?? []))];
        for (const turn of [...session.turns].sort((left, right) => left.turn - right.turn)) {
            const id = canonical.get(addressKey(sid, turn.turn));
            refs[turn.turn] = id;
            const localNode = local.nodes[id];
            const existing = nodes[id];
            if (existing === undefined) {
                const isForkMarker = id === forkNodeId(sid, turn.turn);
                const parentSession = session.parentSessionId === undefined ? undefined : sessionsById.get(session.parentSessionId);
                const parentTurn = isForkMarker
                    ? parentSession?.turns.find(candidate => candidate.turn === turn.turn && candidate.fingerprint === turn.fingerprint)
                    : undefined;
                const forkSourceId = parentSession !== undefined && parentTurn !== undefined
                    ? canonical.get(addressKey(parentSession.sessionId, parentTurn.turn))
                    : undefined;
                const forkSource = forkSourceId === undefined ? undefined : nodes[forkSourceId];
                // A viewed official fork may already have browser-ledger nodes for its
                // copied prefix. Their relations point at those duplicate ids, so use
                // the proven Host lineage for the entire ordinary-fork branch.
                const useLocalRelations = localNode !== undefined && !isForkMarker && !ordinaryForkTips.has(sid);
                const isFirstMergedOwnTurn = session.mergeSources !== undefined
                    && !turn.inherited && firstOwn && exactMergeParents.length > 0;
                if (isFirstMergedOwnTurn)
                    exactMergeRelationIds.add(id);
                const primaryParentId = isForkMarker
                    ? forkSource?.primaryParentId ?? null
                    : isFirstMergedOwnTurn
                        ? exactMergeParents.at(-1) ?? null
                        : useLocalRelations ? localNode.primaryParentId : previousId;
                const parentIds = isForkMarker
                    ? primaryParentId === null ? [] : [primaryParentId]
                    : isFirstMergedOwnTurn
                        ? exactMergeParents
                        : useLocalRelations
                            ? localNode.parentIds.filter(parentId => local.nodes[parentId] !== undefined)
                            : previousId === null ? [] : [previousId];
                nodes[id] = {
                    id,
                    sessionId: localNode?.sessionId ?? sid,
                    turn: localNode?.turn ?? turn.turn,
                    prompt: localNode?.prompt ?? turn.prompt,
                    answer: localNode?.answer ?? turn.answer,
                    createdAt: isForkMarker ? session.createdAt : localNode?.createdAt ?? turn.startedAt,
                    completedAt: turn.completedAt,
                    sessionCreatedAt: session.createdAt,
                    sessionTitle: titleOf(localNode?.sessionId ?? sid, titles),
                    firstInSession: !turn.inherited && firstOwn,
                    fingerprint: turn.fingerprint,
                    ...(forkSourceId === undefined ? {} : { forkSourceId }),
                    boundarySeq: localNode?.boundarySeq ?? turn.boundarySeq,
                    primaryParentId,
                    parentIds,
                    contextManifest: isForkMarker
                        ? forkSource?.contextManifest ?? (primaryParentId === null ? [] : [primaryParentId])
                        : isFirstMergedOwnTurn
                            ? exactMergeParents
                            : localNode?.contextManifest ?? (primaryParentId === null ? [] : [primaryParentId]),
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
        if (local.nodes[id] !== undefined || exactMergeRelationIds.has(id))
            continue;
        nodes[id] = { ...node, contextManifest: primaryPath(provisional, node.primaryParentId) };
    }
    const timeline = Object.values(nodes)
        .filter(node => node.forkSourceId === undefined)
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
    const timelineCount = Math.max(1, Math.min(count, model.timeline.length));
    const visibleIds = new Set(model.timeline.slice(0, timelineCount));
    const cutoff = model.nodes[model.timeline[timelineCount - 1] ?? '']?.completedAt ?? Number.NEGATIVE_INFINITY;
    for (const node of Object.values(model.nodes)) {
        if (node.forkSourceId !== undefined && node.sessionCreatedAt <= cutoff)
            visibleIds.add(node.id);
    }
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