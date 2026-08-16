import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MAX_MERGED_HISTORY_TURNS } from "../protocol.js";
import { ChatHistoryPreview } from "./ChatHistoryPreview.js";
import { GraphCanvas } from "./GraphCanvas.js";
import { PAContextWindow } from "./PAContextWindow.js";
import { extractCompletedTurns } from "./extract.js";
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
    const snapshot = useSession(value => value);
    const input = useInput(value => value);
    const localState = useGraph((value) => value);
    const turns = useMemo(() => extractCompletedTurns(snapshot), [snapshot]);
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
    const [preview, setPreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState(null);
    const mergeAbortRef = useRef(null);
    const trayOwnerRef = useRef({});
    useEffect(() => () => { mergeAbortRef.current?.abort(); }, []);
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
    const previewKey = previewEntries.map(({ source }) => `${source.sourceSessionId}:${source.sourceTurn}:${source.sourceBoundarySeq}`).join('|');
    const composerBlocked = dirty || busy;
    useEffect(() => {
        setComposerBlocked(composerBlocked);
        return () => { setComposerBlocked(false); };
    }, [composerBlocked, setComposerBlocked, locale]);
    useEffect(() => {
        const sources = previewEntries.map(entry => entry.source);
        if (sources.length === 0) {
            setPreview(null);
            setPreviewLoading(false);
            setPreviewError(null);
            return;
        }
        if (sources.length > MAX_MERGED_HISTORY_TURNS) {
            setPreview(null);
            setPreviewLoading(false);
            setPreviewError(localized(`单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`, `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale));
            return;
        }
        const controller = new AbortController();
        setPreview(null);
        setPreviewLoading(true);
        setPreviewError(null);
        void loadHistoryPreview(sources, controller.signal).then((response) => {
            if (controller.signal.aborted)
                return;
            setPreview(response);
            setPreviewLoading(false);
        }).catch((cause) => {
            if (controller.signal.aborted)
                return;
            setPreviewError(cause instanceof Error ? cause.message : String(cause));
            setPreviewLoading(false);
        });
        return () => controller.abort();
    }, [previewKey, loadHistoryPreview, locale]);
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
    const canvasState = {
        ...state,
        headNodeId: baselineIds.at(-1) ?? state.headNodeId,
        contextManifest: [],
    };
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
    return _jsx("div", { className: "dsh-git-root", "data-conversation-composer-overlay": "", children: _jsxs("div", { className: "dsh-git-workbench", children: [_jsxs("div", { className: `dsh-git-branch-left ${inspected === undefined ? '' : 'dsh-git-branch-left-open'}`, children: [_jsxs("section", { className: "dsh-git-graph-panel", "aria-label": "Conversation Graph", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsx("span", { children: "Conversation Graph" }), _jsx("span", { className: "dsh-git-muted", children: projectError ?? localized('蓝色：已加入 · 绿色：预览', 'Blue: included · green: preview', locale) })] }), _jsx(GraphCanvas, { state: canvasState, previewNodeId: inspectedId, selectedNodeIds: selectedIds, candidateNodeId: candidateId, disabled: busy, onPreview: inspect })] }), inspected === undefined || inspectedId === null ? null : _jsx(PAContextWindow, { state: state, nodeId: inspectedId, label: labels.get(inspectedId) ?? 'PA', selected: inspectedSelected, disabled: busy, onAdd: addCandidate, onRemove: () => remove(inspectedId), onClose: closeInspector })] }), _jsxs("section", { className: "dsh-git-chat-panel", "aria-label": "Chat History", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsx("span", { children: "Chat History" }), _jsxs("span", { className: "dsh-git-muted", children: [selectedIds.length, " ", localized('已加入', 'included', locale), candidateId === null ? '' : localized(' + 1 预览', ' + 1 preview', locale)] })] }), _jsx(ChatHistoryPreview, { response: preview, orderedNodeIds: previewEntries.map(entry => entry.nodeId), labels: labels, candidateNodeId: candidateId, loading: previewLoading, error: previewError, loadImage: loadPreviewImage })] })] }) });
}
//# sourceMappingURL=GraphView.js.map