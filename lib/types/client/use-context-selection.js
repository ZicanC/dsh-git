/** The Context being assembled in the Branches view: which PAs, in what order, reached through which Session. */
import { useEffect, useMemo, useState } from 'react';
import { paIdentityId } from "./graph.js";
function sessionHistory(state, sessionId) {
    return [...new Set(Object.entries(state.sessionTurnRefs[sessionId] ?? {})
            .sort(([left], [right]) => Number(left) - Number(right))
            .flatMap(([, nodeId]) => state.nodes[nodeId] === undefined ? [] : [nodeId]))];
}
function sameIds(left, right) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}
/**
 * Own the Context selection of one Branches view.
 *
 * Untouched, the selection is the Chat's own history and follows it: a turn
 * that completes joins it. The first edit stops that; undoing every edit
 * starts it again. While an anchor is active the selection is the anchored
 * PAs and cannot be edited.
 * @param state - the graph the selection is drawn from.
 * @param anchor - the active anchor of this Chat, if any.
 * @param locked - whether edits are refused: an action is in flight, or the Chat is anchored.
 */
export function useContextSelection(state, sessionId, anchor, locked) {
    const [selectionVia, setSelectionVia] = useState({});
    const [selectedIds, setSelectedIds] = useState([]);
    const [baselineIds, setBaselineIds] = useState([]);
    const [selectionTouched, setSelectionTouched] = useState(false);
    const [inspectedId, setInspectedId] = useState(null);
    const currentSessionIds = useMemo(() => sessionHistory(state, sessionId), [state, sessionId]);
    const currentSessionKey = currentSessionIds.join('\u0000');
    // Keyed on the history's content, not its array identity: every ledger
    // snapshot yields a new array for the same history.
    useEffect(() => {
        if (selectionTouched)
            return;
        setBaselineIds(currentSessionIds);
        setSelectedIds(currentSessionIds);
    }, [currentSessionKey, selectionTouched]);
    useEffect(() => {
        if (anchor === undefined)
            return;
        const fixed = anchor.nodeIds.filter(nodeId => state.nodes[nodeId] !== undefined);
        setSelectedIds(fixed);
        setInspectedId(null);
        setSelectionTouched(true);
    }, [anchor, state.nodes]);
    const sourcePathsChanged = baselineIds.some(id => selectionVia[id] !== undefined && selectionVia[id] !== sessionId);
    // A selection edited back to the baseline is not a lasting edit. Re-arm
    // baseline following so a later official turn joins the blue history.
    useEffect(() => {
        if (selectionTouched && sameIds(selectedIds, baselineIds) && !sourcePathsChanged) {
            setSelectionTouched(false);
        }
    }, [selectionTouched, selectedIds, baselineIds, sourcePathsChanged]);
    const sources = Object.fromEntries(selectedIds.map(id => [id,
        selectionVia[id] ?? (currentSessionIds.includes(id) ? sessionId : state.nodes[id]?.sessionId ?? ''),
    ]));
    const commitOrder = (next) => {
        setSelectedIds([...next]);
        setSelectionTouched(true);
    };
    return {
        currentSessionIds,
        selectedIds,
        baselineIds,
        inspectedId,
        dirty: anchor === undefined && (!sameIds(selectedIds, baselineIds) || sourcePathsChanged),
        sources,
        inspect: (nodeId) => {
            if (locked)
                return false;
            setInspectedId(nodeId);
            return true;
        },
        closeInspector: () => {
            const closingId = inspectedId;
            setInspectedId(null);
            if (closingId !== null) {
                const trigger = [...document.querySelectorAll('.dsh-git-tree-node')]
                    .find(button => button.dataset.nodeId === closingId);
                trigger?.focus();
            }
        },
        addInspected: () => {
            if (locked)
                return;
            if (inspectedId === null || state.nodes[inspectedId] === undefined)
                return;
            setSelectionVia(via => ({ ...via, [inspectedId]: state.nodes[inspectedId].sessionId }));
            // Inspecting is read-only. Only this explicit action changes Context.
            setSelectedIds((ids) => {
                const identityId = paIdentityId(state, inspectedId);
                const existingIndex = ids.findIndex(nodeId => paIdentityId(state, nodeId) === identityId);
                if (existingIndex < 0)
                    return [...ids, inspectedId];
                if (ids[existingIndex] === inspectedId)
                    return ids;
                const next = [...ids];
                next[existingIndex] = inspectedId;
                return next;
            });
            setSelectionTouched(true);
        },
        remove: (nodeId) => {
            if (locked)
                return;
            setSelectedIds(ids => ids.filter(id => id !== nodeId));
            if (inspectedId === nodeId)
                setInspectedId(null);
            setSelectionTouched(true);
        },
        move: (nodeId, beforeId) => {
            if (locked)
                return;
            if (nodeId === beforeId || !selectedIds.includes(nodeId))
                return;
            const next = selectedIds.filter(id => id !== nodeId);
            const index = next.indexOf(beforeId);
            if (index < 0)
                return;
            next.splice(index, 0, nodeId);
            commitOrder(next);
        },
        moveEnd: (nodeId) => {
            if (locked)
                return;
            if (!selectedIds.includes(nodeId))
                return;
            commitOrder([...selectedIds.filter(id => id !== nodeId), nodeId]);
        },
        reset: (forgetPaths) => {
            if (forgetPaths)
                setSelectionVia({});
            setSelectedIds(currentSessionIds);
            setBaselineIds(currentSessionIds);
            setSelectionTouched(false);
            setInspectedId(null);
        },
    };
}
//# sourceMappingURL=use-context-selection.js.map