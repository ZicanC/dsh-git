/** Identity survives projection into another scope and does not depend on labels. */
export function identityOf(state, id) {
    const seen = new Set();
    let node = state.nodes[id];
    while (node?.forkSourceId !== undefined) {
        if (seen.has(node.id))
            throw new Error('Cyclic fork identity');
        seen.add(node.id);
        node = state.nodes[node.forkSourceId];
    }
    if (node === undefined)
        throw new Error(`Missing PA identity: ${id}`);
    return node.paId ?? `pa:${encodeURIComponent(node.sessionId)}:${node.turn}:${node.boundarySeq}`;
}
/** {@link identityOf}, for a ledger that may still hold a dangling or cyclic fork chain. */
function identityOrUndefined(state, id) {
    try {
        return identityOf(state, id);
    }
    catch {
        return undefined;
    }
}
/** Everything a record waits for before it can be finalized. */
function finalizationDependencies(node) {
    return [
        ...node.parentIds,
        ...(node.forkSourceId === undefined ? [] : [node.forkSourceId]),
        ...(node.contextKnown === true ? node.contextManifest : []),
    ];
}
/**
 * Send a finalized record back to the queue when something it depends on is
 * no longer finalized before it.
 *
 * Replacing one occurrence with another can leave a child numbered ahead of
 * its new parent. Only the finalization event is released: the PA number stays
 * with the record, so labels do not change while the layout order is rebuilt.
 */
function requeueOutOfOrder(nodes) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of Object.values(nodes)) {
            if (node.finalOrdinal === undefined)
                continue;
            const late = finalizationDependencies(node).some(id => {
                const dependency = nodes[id];
                return dependency !== undefined
                    && (dependency.finalOrdinal === undefined || dependency.finalOrdinal > node.finalOrdinal);
            });
            if (!late)
                continue;
            nodes[node.id] = { ...node, finalOrdinal: undefined };
            changed = true;
        }
    }
}
/**
 * Retire node ids in favour of others, rewriting every reference the ledger holds.
 *
 * Each key of `replacements` is removed from the graph and every edge, Context
 * entry, Session history ref, pending recipe, anchor, branch head, and view
 * pointer that named it now names the replacement. A Context reference follows
 * its PA to the replacement's identity, so no reference is left dangling.
 */
export function replaceNodes(state, replacements) {
    if (replacements.size === 0)
        return state;
    const replace = (id) => {
        const seen = new Set();
        let cursor = id;
        while (replacements.has(cursor) && !seen.has(cursor)) {
            seen.add(cursor);
            cursor = replacements.get(cursor);
        }
        return cursor;
    };
    const list = (ids) => [...new Set(ids.map(replace))];
    // Identities are read before anything moves; afterwards the old ids are gone.
    const identities = new Map();
    for (const retired of replacements.keys()) {
        const before = identityOrUndefined(state, retired);
        const after = identityOrUndefined(state, replace(retired));
        if (before !== undefined && after !== undefined && before !== after)
            identities.set(before, after);
    }
    const references = (refs) => {
        if (identities.size === 0)
            return refs;
        const seen = new Set();
        return refs.flatMap(ref => {
            const paId = identities.get(ref.paId) ?? ref.paId;
            if (seen.has(paId))
                return [];
            seen.add(paId);
            return [paId === ref.paId ? ref : { ...ref, paId }];
        });
    };
    const nodes = {};
    for (const [id, node] of Object.entries(state.nodes)) {
        if (replacements.has(id))
            continue;
        const parentIds = list(node.parentIds).filter(parentId => parentId !== id);
        const primary = node.primaryParentId === null ? null : replace(node.primaryParentId);
        const forkSourceId = node.forkSourceId === undefined ? undefined : replace(node.forkSourceId);
        nodes[id] = {
            ...node,
            parentIds,
            primaryParentId: primary !== null && parentIds.includes(primary) ? primary : parentIds.at(-1) ?? null,
            contextManifest: list(node.contextManifest).filter(contextId => contextId !== id),
            ...(node.contextRefs === undefined ? {} : { contextRefs: references(node.contextRefs) }),
            ...(forkSourceId === undefined ? {} : { forkSourceId }),
        };
    }
    // A fork copy re-pointed at another source shares that source's identity and number.
    for (const [id, node] of Object.entries(nodes)) {
        if (node.forkSourceId === undefined || node.forkSourceId === state.nodes[id]?.forkSourceId)
            continue;
        const source = nodes[node.forkSourceId];
        if (source !== undefined)
            nodes[id] = { ...node, paId: undefined, ledgerOrdinal: source.ledgerOrdinal };
    }
    requeueOutOfOrder(nodes);
    const pointer = (id) => id === null ? null : replace(id);
    return {
        ...state,
        nodes,
        branches: Object.fromEntries(Object.entries(state.branches).map(([id, branch]) => [id, { ...branch, headId: pointer(branch.headId) }])),
        sessionTurnRefs: Object.fromEntries(Object.entries(state.sessionTurnRefs).map(([sessionId, refs]) => [sessionId, Object.fromEntries(Object.entries(refs).map(([turn, id]) => [turn, replace(id)]))])),
        pendingMerges: Object.fromEntries(Object.entries(state.pendingMerges).map(([sessionId, pending]) => [sessionId, {
                ...pending,
                parentIds: list(pending.parentIds),
                primaryParentId: pointer(pending.primaryParentId),
                contextManifest: list(pending.contextManifest),
                ...(pending.contextRefs === undefined ? {} : { contextRefs: references(pending.contextRefs) }),
            }])),
        anchors: Object.fromEntries(Object.entries(state.anchors).map(([sessionId, anchor]) => [sessionId, { ...anchor, nodeIds: list(anchor.nodeIds) }])),
        headNodeId: pointer(state.headNodeId),
        previewNodeId: pointer(state.previewNodeId),
        contextManifest: list(state.contextManifest),
    };
}
/**
 * Collapse records that describe the same PA occurrence in the same Session.
 *
 * A Session holds at most one occurrence of a PA. Ledgers written before that
 * rule was enforced, and graphs observed under another id scheme, can carry
 * the same turn twice: once under the id its Session history references and
 * once under an unreferenced id. The referenced record survives and inherits
 * any number the other had already been given; a ledger with nothing to
 * collapse is returned as the same object.
 */
export function repairOccurrences(state) {
    const referenced = new Set(Object.values(state.sessionTurnRefs).flatMap(refs => Object.values(refs)));
    const groups = new Map();
    for (const node of Object.values(state.nodes)) {
        const identity = identityOrUndefined(state, node.id);
        if (identity === undefined)
            continue;
        const key = JSON.stringify([node.sessionId, identity]);
        groups.set(key, [...(groups.get(key) ?? []), node]);
    }
    const replacements = new Map();
    const survivors = {};
    for (const group of groups.values()) {
        if (group.length < 2)
            continue;
        const [survivor, ...retired] = [...group].sort((left, right) => Number(referenced.has(right.id)) - Number(referenced.has(left.id))
            || (left.ledgerOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.ledgerOrdinal ?? Number.MAX_SAFE_INTEGER)
            || (left.finalOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.finalOrdinal ?? Number.MAX_SAFE_INTEGER)
            || left.id.localeCompare(right.id));
        const numbered = retired.find(node => node.ledgerOrdinal !== undefined);
        survivors[survivor.id] = survivor.ledgerOrdinal !== undefined || numbered === undefined ? survivor : {
            ...survivor,
            paId: survivor.paId ?? numbered.paId,
            ledgerOrdinal: numbered.ledgerOrdinal,
            finalOrdinal: survivor.finalOrdinal ?? numbered.finalOrdinal,
        };
        for (const node of retired)
            replacements.set(node.id, survivor.id);
    }
    if (replacements.size === 0)
        return state;
    return replaceNodes({ ...state, nodes: { ...state.nodes, ...survivors } }, replacements);
}
/** Append stable numbering in dependency order. Existing final events never move. */
export function finalizeGraph(state) {
    const nodes = { ...state.nodes };
    let ledger = Math.max(state.ledgerSequence ?? 0, ...Object.values(nodes).map(node => node.ledgerOrdinal ?? 0));
    let event = Math.max(state.finalSequence ?? 0, ...Object.values(nodes).map(node => node.finalOrdinal ?? 0));
    // Reserve imported PA labels while migrating older ledgers.
    for (const node of Object.values(nodes)) {
        const label = /^PA([1-9]\d*)$/.exec(node.displayLabel ?? '');
        if (label !== null)
            ledger = Math.max(ledger, Number(label[1]));
    }
    const pending = new Map(Object.values(nodes)
        .filter(node => node.finalOrdinal === undefined)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map(node => [node.id, node]));
    while (pending.size > 0) {
        let progressed = false;
        for (const [id, node] of pending) {
            if (finalizationDependencies(node).some(dep => nodes[dep]?.finalOrdinal === undefined))
                continue;
            const source = node.forkSourceId === undefined ? undefined : nodes[node.forkSourceId];
            nodes[id] = {
                ...node,
                paId: identityOf({ ...state, nodes }, id),
                ledgerOrdinal: source?.ledgerOrdinal ?? node.ledgerOrdinal ?? ++ledger,
                finalOrdinal: ++event,
            };
            pending.delete(id);
            progressed = true;
            // Reconsider earlier waiting records as soon as a dependency finalizes.
            break;
        }
        if (!progressed)
            break;
    }
    return { ...state, nodes, ledgerSequence: ledger, finalSequence: event };
}
/** Semantic validation at the write boundary; malformed batches are never repaired silently. */
export function assertGraphSemantics(state) {
    const unique = (ids, label) => {
        if (new Set(ids).size !== ids.length)
            throw new Error(`Duplicate ${label}`);
    };
    const requireNode = (id) => {
        if (state.nodes[id] === undefined)
            throw new Error(`Missing graph reference: ${id}`);
    };
    const validateContext = (manifest, refs) => {
        manifest.forEach(requireNode);
        unique(manifest.map(id => identityOf(state, id)), 'Context identity');
        if (refs === undefined)
            return manifest;
        unique(refs.map(ref => ref.paId), 'Context identity');
        if (refs.length !== manifest.length)
            throw new Error('Context references disagree');
        return refs.map((ref, index) => {
            if (ref.paId !== identityOf(state, manifest[index]))
                throw new Error('Context identity disagrees');
            const matches = Object.values(state.sessionTurnRefs[ref.viaSessionId] ?? {})
                .filter(id => state.nodes[id] !== undefined && identityOf(state, id) === ref.paId);
            if (matches.length !== 1)
                throw new Error('Context source is not a unique history member');
            return matches[0];
        });
    };
    const dependencies = new Map();
    const occurrences = new Set();
    const originals = new Set();
    const events = new Set();
    const numbers = new Set();
    for (const [id, node] of Object.entries(state.nodes)) {
        if (id !== node.id)
            throw new Error('Node key must match its id');
        unique(node.parentIds, 'parents');
        unique(node.contextManifest, 'Context');
        if (node.parentIds.includes(id) || node.contextManifest.includes(id))
            throw new Error('Self reference');
        if ((node.parentIds.length === 0) !== (node.primaryParentId === null)
            || (node.primaryParentId !== null && !node.parentIds.includes(node.primaryParentId))) {
            throw new Error('Primary parent must agree with parents');
        }
        if (node.forkSourceId !== undefined && node.parentIds.length !== 0)
            throw new Error('Fork copies cannot have parents');
        const refs = [...node.parentIds, ...node.contextManifest,
            ...(node.forkSourceId === undefined ? [] : [node.forkSourceId])];
        refs.forEach(requireNode);
        dependencies.set(id, refs);
        if (node.finalOrdinal !== undefined) {
            if (events.has(node.finalOrdinal))
                throw new Error('Duplicate finalization ordinal');
            events.add(node.finalOrdinal);
        }
        if (node.forkSourceId === undefined && node.ledgerOrdinal !== undefined) {
            if (numbers.has(node.ledgerOrdinal))
                throw new Error('Duplicate PA ordinal');
            numbers.add(node.ledgerOrdinal);
        }
    }
    const done = new Set();
    const visiting = new Set();
    const visit = (id) => {
        if (done.has(id))
            return;
        if (visiting.has(id))
            throw new Error('Cyclic graph dependencies');
        visiting.add(id);
        for (const dep of dependencies.get(id) ?? [])
            visit(dep);
        visiting.delete(id);
        done.add(id);
    };
    for (const id of dependencies.keys())
        visit(id);
    for (const node of Object.values(state.nodes)) {
        const identity = identityOf(state, node.id);
        const occurrence = JSON.stringify([node.sessionId, identity]);
        if (occurrences.has(occurrence))
            throw new Error('Duplicate Session PA occurrence');
        occurrences.add(occurrence);
        if (node.forkSourceId === undefined) {
            if (originals.has(identity))
                throw new Error('Duplicate original PA identity');
            originals.add(identity);
        }
        else {
            const source = state.nodes[node.forkSourceId];
            if ((node.paId !== undefined && node.paId !== identity)
                || node.ledgerOrdinal !== source.ledgerOrdinal)
                throw new Error('Fork identity does not match source');
        }
        const resolved = validateContext(node.contextManifest, node.contextRefs);
        if (node.contextRefs !== undefined && node.parentIds.length > 1) {
            const terminals = new Map();
            node.contextRefs.forEach((ref, index) => terminals.set(ref.viaSessionId, index));
            const expected = [...terminals.values()].sort((a, b) => a - b).map(index => resolved[index]);
            if (JSON.stringify(expected) !== JSON.stringify(node.parentIds)
                || node.primaryParentId !== expected.at(-1))
                throw new Error('Merge parents disagree with Context sources');
        }
    }
    for (const refs of Object.values(state.sessionTurnRefs))
        Object.values(refs).forEach(requireNode);
    validateContext(state.contextManifest);
    for (const pending of Object.values(state.pendingMerges)) {
        validateContext(pending.contextManifest, pending.contextRefs);
        unique(pending.parentIds, 'pending parents');
        pending.parentIds.forEach(requireNode);
        if (pending.primaryParentId === null || !pending.parentIds.includes(pending.primaryParentId)) {
            throw new Error('Pending primary parent must agree with parents');
        }
    }
}
//# sourceMappingURL=graph-ledger.js.map