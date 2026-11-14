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
            const dependencies = [...node.parentIds,
                ...(node.forkSourceId === undefined ? [] : [node.forkSourceId]),
                ...(node.contextKnown === true ? node.contextManifest : [])];
            if (dependencies.some(dep => nodes[dep]?.finalOrdinal === undefined))
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