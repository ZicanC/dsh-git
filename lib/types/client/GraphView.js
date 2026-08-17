import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { MAX_MERGED_HISTORY_TURNS } from "../protocol.js";
import { ChatHistoryPreview, } from "./ChatHistoryPreview.js";
import { GraphCanvas } from "./GraphCanvas.js";
import { HistoryRail } from "./HistoryRail.js";
import { historyRailModel } from "./history-rail.js";
import { PAContextWindow } from "./PAContextWindow.js";
import { extractCompletedTurns } from "./extract.js";
import { projectLiveTurns } from "./live-turn.js";
import { HistoryPreviewCache, previewSourceKey } from "./preview-cache.js";
import { nodeLabelMap } from "./labels.js";
import { assembleProjectGraph } from "./project-graph.js";
import { localized, useLocale } from "./i18n.js";
function distinct(ids) {
    return [...new Set(ids)];
}
function sessionHistory(state, sessionId) {
    return distinct(Object.entries(state.sessionTurnRefs[sessionId] ?? {})
        .sort(([left], [right]) => Number(left) - Number(right))
        .flatMap(([, nodeId]) => state.nodes[nodeId] === undefined ? [] : [nodeId]));
}
function sameIds(left, right) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}
function sourceOf(state, nodeId) {
    const node = state.nodes[nodeId];
    return node === undefined ? null : {
        sourceSessionId: node.sessionId,
        sourceTurn: node.turn,
        sourceBoundarySeq: node.boundarySeq,
    };
}
function isAbort(cause, signal) {
    return signal.aborted
        || (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError');
}
/** Complete Branches workbench: graph selection, read-only history, and Merge. */
export function GraphView({ sessionId, useSession, useInput, inputActions, useGraph, syncTurns, adoptObservedGraph, loadProjectGraph, loadHistoryPreview, loadPreviewImage, tray, setComposerBlocked, createMergedSession, }) {
    const locale = useLocale();
    // Narrow subscriptions: an assistant delta swaps only `partial`, so the
    // graph, the rail, and every settled Chat History section keep their
    // memoized render while the live tail streams.
    const nodes = useSession(value => value.nodes);
    const timeline = useSession(value => value.chat.timeline);
    const partial = useSession(value => value.partial);
    const runningCalls = useSession(value => value.runningCalls);
    const input = useInput(value => value);
    const localState = useGraph((value) => value);
    const turns = useMemo(() => extractCompletedTurns({ nodes, chat: { timeline } }), [nodes, timeline]);
    const turnSignature = turns.map(turn => `${turn.turn}:${turn.boundarySeq}:${turn.answer.length}`).join('|');
    const [project, setProject] = useState(null);
    const [projectError, setProjectError] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);
    const [baselineIds, setBaselineIds] = useState([]);
    const [selectionTouched, setSelectionTouched] = useState(false);
    const [candidateId, setCandidateId] = useState(null);
    // Where the dashed candidate sits in the previewed merge order; the user can
    // move it before deciding to add it, so it is not always the last entry.
    const [candidateIndex, setCandidateIndex] = useState(0);
    const [inspectedId, setInspectedId] = useState(null);
    const [graphOpen, setGraphOpen] = useState(true);
    const [activeTrailId, setActiveTrailId] = useState(null);
    const [previewRevision, setPreviewRevision] = useState(0);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState(null);
    const mergeAbortRef = useRef(null);
    const trayOwnerRef = useRef({});
    // A completed turn is immutable, so its records are cached for the lifetime
    // of this view and never re-read when the selection changes.
    const previewCacheRef = useRef(new HistoryPreviewCache());
    const previewInFlightRef = useRef(new Set());
    const previewAbortRef = useRef(null);
    useEffect(() => () => { mergeAbortRef.current?.abort(); }, []);
    useEffect(() => () => { previewAbortRef.current?.abort(); }, []);
    useEffect(() => { syncTurns(turns); }, [turnSignature, syncTurns]);
    useEffect(() => {
        const controller = new AbortController();
        setProjectError(null);
        void loadProjectGraph(controller.signal).then((loaded) => {
            if (!controller.signal.aborted)
                setProject(loaded);
        }).catch((cause) => {
            if (controller.signal.aborted)
                return;
            setProjectError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => controller.abort();
    }, [sessionId, loadProjectGraph]);
    const projectModel = useMemo(() => project === null
        ? null
        : assembleProjectGraph(project.response, localState, project.sessionTitles), [project, localState]);
    const state = projectModel?.state ?? localState;
    useEffect(() => {
        if (projectModel !== null)
            adoptObservedGraph(projectModel.state);
    }, [projectModel, adoptObservedGraph]);
    const currentSessionIds = useMemo(() => sessionHistory(state, String(sessionId)), [state, sessionId]);
    const currentSessionKey = currentSessionIds.join('\u0000');
    useEffect(() => {
        if (selectionTouched)
            return;
        setBaselineIds(currentSessionIds);
        setSelectedIds(currentSessionIds);
    }, [currentSessionKey, selectionTouched]);
    // A candidate that was only inspected and then closed is not a lasting edit.
    // Re-arm baseline following so a later official turn joins the blue history.
    useEffect(() => {
        if (selectionTouched && candidateId === null && sameIds(selectedIds, baselineIds)) {
            setSelectionTouched(false);
        }
    }, [selectionTouched, candidateId, selectedIds, baselineIds]);
    const labels = useMemo(() => nodeLabelMap(state), [state]);
    const dirty = candidateId !== null || !sameIds(selectedIds, baselineIds);
    const previewId = candidateId !== null && !selectedIds.includes(candidateId) ? candidateId : null;
    const previewIndex = Math.min(Math.max(candidateIndex, 0), selectedIds.length);
    const orderedPreviewIds = useMemo(() => previewId === null
        ? selectedIds
        : [...selectedIds.slice(0, previewIndex), previewId, ...selectedIds.slice(previewIndex)], [selectedIds, previewId, previewIndex]);
    // Keep the node label currency paired with the exact sources sent to the
    // Host. If a stale graph reference cannot resolve, filtering the pair
    // together prevents every later PA label from shifting by one.
    const previewEntries = useMemo(() => orderedPreviewIds.flatMap(nodeId => {
        const source = sourceOf(state, nodeId);
        return source === null ? [] : [{ nodeId, source }];
    }), [orderedPreviewIds, state]);
    const previewNodeIds = useMemo(() => previewEntries.map(entry => entry.nodeId), [previewEntries]);
    const previewKey = previewEntries.map(({ source }) => `${source.sourceSessionId}:${source.sourceTurn}:${source.sourceBoundarySeq}`).join('|');
    // Only the Merge flight makes the official composer inert: the draft is being
    // transferred, and any edit during it aborts the transfer. A merely unmerged
    // Context keeps the composer typable — the composer-row guard refuses the
    // send gestures instead, so the draft can be written before the Merge.
    useEffect(() => {
        setComposerBlocked(busy);
        return () => { setComposerBlocked(false); };
    }, [busy, setComposerBlocked, locale]);
    const overLimit = previewEntries.length > MAX_MERGED_HISTORY_TURNS;
    // Only PAs this view has never read are requested, and a request in flight
    // is never cancelled by a later selection edit: its records stay valid for
    // whatever selection is current when they land. Removing a PA is therefore
    // pure local work, and re-adding one costs no Host round trip at all.
    useEffect(() => {
        const sources = previewEntries.map(entry => entry.source);
        if (sources.length === 0 || overLimit) {
            setPreviewLoading(false);
            setPreviewError(overLimit
                ? localized(`单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`, `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale)
                : null);
            return;
        }
        const inFlight = previewInFlightRef.current;
        const missing = previewCacheRef.current.missing(sources)
            .filter(source => !inFlight.has(previewSourceKey(source)));
        if (missing.length === 0) {
            setPreviewLoading(inFlight.size > 0);
            if (inFlight.size === 0)
                setPreviewError(null);
            return;
        }
        previewAbortRef.current ??= new AbortController();
        const signal = previewAbortRef.current.signal;
        const keys = missing.map(previewSourceKey);
        for (const key of keys)
            inFlight.add(key);
        setPreviewLoading(true);
        setPreviewError(null);
        void loadHistoryPreview(missing, signal).then((response) => {
            if (signal.aborted)
                return;
            previewCacheRef.current.absorb(response);
            setPreviewRevision(revision => revision + 1);
        }).catch((cause) => {
            if (signal.aborted)
                return;
            setPreviewError(cause instanceof Error ? cause.message : String(cause));
        }).finally(() => {
            for (const key of keys)
                inFlight.delete(key);
            if (!signal.aborted)
                setPreviewLoading(inFlight.size > 0);
        });
    }, [previewKey, overLimit, loadHistoryPreview, locale]);
    const preview = useMemo(() => {
        if (previewEntries.length === 0 || overLimit)
            return null;
        return previewCacheRef.current.assemble(previewEntries.map(entry => entry.source));
        // previewRevision republishes the assembly after a Host read lands.
    }, [previewEntries, overLimit, previewRevision]);
    const pendingNodeIds = useMemo(() => new Set(previewEntries.flatMap(entry => previewCacheRef.current.has(entry.source) ? [] : [entry.nodeId])), [previewEntries, previewRevision]);
    // The graph only owns a turn once it closes, so everything after the last
    // registered turn is still being produced: that is exactly what the live
    // tail renders, straight from the official conversation snapshot.
    const registeredTurn = useMemo(() => Object.entries(state.sessionTurnRefs[String(sessionId)] ?? {})
        .reduce((highest, [turn, nodeId]) => state.nodes[nodeId] === undefined
        ? highest
        : Math.max(highest, Number(turn)), 0), [state, sessionId]);
    const liveTurns = useMemo(() => projectLiveTurns({
        nodes,
        chat: { timeline },
        partial: partial ?? null,
        runningCalls: runningCalls ?? [],
    }, registeredTurn).map(turn => ({
        key: turn.key,
        label: localized(`第 ${turn.turn} 轮`, `Turn ${turn.turn}`, locale),
        sourceSessionId: String(sessionId),
        records: turn.records,
    })), [nodes, timeline, partial, runningCalls, registeredTurn, sessionId, locale]);
    const inspect = (nodeId) => {
        if (busy)
            return;
        setActionError(null);
        setInspectedId(nodeId);
        if (selectedIds.includes(nodeId)) {
            setCandidateId(null);
            return;
        }
        setCandidateId(nodeId);
        setCandidateIndex(selectedIds.length);
        setSelectionTouched(true);
    };
    const closeInspector = () => {
        const closingId = inspectedId;
        if (candidateId === inspectedId)
            setCandidateId(null);
        setInspectedId(null);
        if (closingId !== null) {
            const trigger = [...document.querySelectorAll('.dsh-git-tree-node')]
                .find(button => button.dataset.nodeId === closingId);
            trigger?.focus();
        }
    };
    // Stable identity: the rail is memoized, and a streaming delta must not
    // re-render it through a fresh callback.
    const jumpToHistory = useCallback((nodeId) => {
        const target = document.getElementById(`dsh-git-history-${nodeId}`);
        if (target === null)
            return;
        target.scrollIntoView({ block: 'start', inline: 'nearest' });
        target.focus({ preventScroll: true });
    }, []);
    const addCandidate = () => {
        if (busy)
            return;
        if (candidateId === null || state.nodes[candidateId] === undefined)
            return;
        // Commit the preview where the user parked it, not at the end.
        setSelectedIds(ids => ids.includes(candidateId)
            ? ids
            : [...ids.slice(0, previewIndex), candidateId, ...ids.slice(previewIndex)]);
        setCandidateId(null);
        setSelectionTouched(true);
    };
    const remove = (nodeId) => {
        if (busy)
            return;
        setSelectedIds(ids => ids.filter(id => id !== nodeId));
        if (inspectedId === nodeId)
            setInspectedId(null);
        if (candidateId === nodeId)
            setCandidateId(null);
        setSelectionTouched(true);
    };
    // Reordering runs over the previewed order, then splits back into the
    // committed selection and the candidate's place inside it.
    const commitOrder = (next) => {
        if (previewId !== null)
            setCandidateIndex(next.indexOf(previewId));
        setSelectedIds(next.filter(id => id !== previewId));
        setSelectionTouched(true);
    };
    const move = (nodeId, beforeId) => {
        if (busy)
            return;
        if (nodeId === beforeId || !orderedPreviewIds.includes(nodeId))
            return;
        const next = orderedPreviewIds.filter(id => id !== nodeId);
        const index = next.indexOf(beforeId);
        if (index < 0)
            return;
        next.splice(index, 0, nodeId);
        commitOrder(next);
    };
    const moveEnd = (nodeId) => {
        if (busy)
            return;
        if (!orderedPreviewIds.includes(nodeId))
            return;
        commitOrder([...orderedPreviewIds.filter(id => id !== nodeId), nodeId]);
    };
    const discard = (send) => {
        const composerAvailable = setComposerBlocked(false);
        setSelectedIds(currentSessionIds);
        setBaselineIds(currentSessionIds);
        setSelectionTouched(false);
        setCandidateId(null);
        setInspectedId(null);
        setActionError(send && !composerAvailable ? localized('来源 Session 仍被其他系统条件阻塞；Context 更改已放弃，请解除阻塞后使用官方输入框发送。', 'Another system condition still blocks the source Session. The context edits were discarded; resolve that block, then send with the official composer.', locale) : null);
        if (send && composerAvailable)
            inputActions.submit();
    };
    const merge = async () => {
        if (busy || selectedIds.length === 0 || candidateId !== null)
            return;
        if (input.phase !== 'plain') {
            setActionError(localized('官方输入框正在处理另一项操作；请等待输入状态稳定后再 Merge。', 'The official composer is handling another operation. Wait for it to settle before merging.', locale));
            return;
        }
        if (selectedIds.length > MAX_MERGED_HISTORY_TURNS) {
            setActionError(localized(`单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`, `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale));
            return;
        }
        const controller = new AbortController();
        mergeAbortRef.current?.abort();
        mergeAbortRef.current = controller;
        setBusy(true);
        setActionError(null);
        try {
            if (input.occurrences.length > 0) {
                throw new Error(localized('输入草稿包含 @ 引用或其他结构化 chip；请先移除或转换为普通文本再 Merge。', 'The draft contains @ references or other structured chips. Remove them or convert them to plain text before merging.', locale));
            }
            await createMergedSession(selectedIds, {
                text: input.draft,
                draftRevision: input.draftRev,
                imageIds: input.imageIds,
                hasStructuredReferences: false,
            }, controller.signal);
        }
        catch (cause) {
            if (!isAbort(cause, controller.signal)) {
                setActionError(cause instanceof Error ? cause.message : String(cause));
            }
        }
        finally {
            if (mergeAbortRef.current === controller)
                mergeAbortRef.current = null;
            setBusy(false);
        }
    };
    const inspected = inspectedId === null ? undefined : state.nodes[inspectedId];
    const inspectedSelected = inspectedId !== null && selectedIds.includes(inspectedId);
    // Memoized: the canvas re-lays out the whole tree whenever this object's
    // identity changes, which must not happen on every streamed delta.
    const canvasState = useMemo(() => ({
        ...state,
        headNodeId: baselineIds.at(-1) ?? state.headNodeId,
        contextManifest: [],
    }), [state, baselineIds]);
    const rail = useMemo(() => historyRailModel(state, {
        selectedIds,
        candidateId,
        headNodeId: canvasState.headNodeId,
        orderedIds: previewNodeIds,
    }), [state, selectedIds, candidateId, canvasState.headNodeId, previewNodeIds]);
    useEffect(() => {
        if (activeTrailId !== null && !previewNodeIds.includes(activeTrailId))
            setActiveTrailId(null);
    }, [activeTrailId, previewNodeIds]);
    const draftHasContent = input.draft.trim() !== '' || input.imageIds.length > 0;
    const trayModel = {
        state,
        selectedIds,
        orderedIds: orderedPreviewIds,
        candidateId,
        busy,
        error: actionError,
        dirty,
        draftHasContent,
        overLimit: selectedIds.length > MAX_MERGED_HISTORY_TURNS,
        onMove: move,
        onMoveEnd: moveEnd,
        onRemove: remove,
        onMerge: merge,
        onDiscard: discard,
        onSendRefused: () => {
            setActionError(localized('Context 尚未 Merge：官方输入框可以继续输入，但发送只能通过 Merge，或「放弃更改并发送」。', 'The Context is unmerged: the composer still accepts text, but sending goes through Merge or “Discard changes and send”.', locale));
        },
    };
    // The Branches view owns all mutable selection state; the official input
    // dock only observes this committed view model. Publish after React commits
    // and clear only this mount's owner token when the tab is left.
    useLayoutEffect(() => {
        tray.publish(trayOwnerRef.current, trayModel);
    });
    useLayoutEffect(() => {
        const owner = trayOwnerRef.current;
        return () => { tray.clear(owner); };
    }, [tray]);
    return _jsx("div", { className: "dsh-git-root", "data-conversation-composer-overlay": "", children: _jsxs("div", { className: `dsh-git-workbench ${graphOpen ? '' : 'dsh-git-workbench-graph-closed'}`, children: [graphOpen && _jsxs("div", { id: "dsh-git-conversation-graph", className: `dsh-git-branch-left ${inspected === undefined ? '' : 'dsh-git-branch-left-open'}`, children: [_jsxs("section", { className: "dsh-git-graph-panel", "aria-label": "Conversation Graph", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsx("span", { children: "Conversation Graph" }), projectError === null
                                            ? _jsxs("span", { className: "dsh-git-legend", children: [_jsx("span", { className: "dsh-git-legend-bar", "aria-hidden": "true" }), _jsx("span", { children: localized('已加入', 'Included', locale) }), _jsx("span", { className: "dsh-git-legend-dot", "aria-hidden": "true" }), _jsx("span", { className: "dsh-git-legend-bar dsh-git-legend-bar-preview", "aria-hidden": "true" }), _jsx("span", { children: localized('预览', 'Preview', locale) })] })
                                            : _jsx("span", { className: "dsh-git-muted", children: projectError })] }), _jsx(GraphCanvas, { state: canvasState, previewNodeId: inspectedId, selectedNodeIds: selectedIds, candidateNodeId: candidateId, disabled: busy, onPreview: inspect })] }), inspected === undefined || inspectedId === null ? null : _jsx(PAContextWindow, { state: state, nodeId: inspectedId, label: labels.get(inspectedId) ?? 'PA', selected: inspectedSelected, disabled: busy, onAdd: addCandidate, onRemove: () => remove(inspectedId), onClose: closeInspector })] }), _jsxs("section", { className: "dsh-git-chat-panel", "aria-label": "Chat History", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsxs("span", { className: "dsh-git-heading-title", children: [_jsx("span", { children: "Chat History" }), _jsx("button", { className: "dsh-git-graph-toggle", type: "button", "aria-controls": "dsh-git-conversation-graph", "aria-expanded": graphOpen, "aria-label": graphOpen
                                                ? localized('关闭 Conversation Graph', 'Close Conversation Graph', locale)
                                                : localized('打开 Conversation Graph', 'Open Conversation Graph', locale), onClick: () => setGraphOpen(open => !open), children: _jsx(IconPanelLeftOutline16, { size: 16 }) })] }), _jsxs("span", { className: "dsh-git-muted", children: [selectedIds.length, " ", localized('已加入', 'included', locale), candidateId === null ? '' : localized(' + 1 预览', ' + 1 preview', locale)] })] }), _jsxs("div", { className: `dsh-git-chat-body ${rail.entries.length === 0
                                ? ''
                                : graphOpen ? 'dsh-git-chat-body-rail' : 'dsh-git-chat-body-rail-expanded'}`, children: [_jsx(HistoryRail, { ...rail, disabled: busy, expanded: !graphOpen, onSelect: jumpToHistory, onActiveChange: setActiveTrailId }), _jsx(ChatHistoryPreview, { response: preview, orderedNodeIds: previewNodeIds, labels: labels, candidateNodeId: candidateId, activeNodeId: activeTrailId, pendingNodeIds: pendingNodeIds, liveTurns: liveTurns, loading: previewLoading, error: previewError, loadImage: loadPreviewImage })] })] })] }) });
}
//# sourceMappingURL=GraphView.js.map