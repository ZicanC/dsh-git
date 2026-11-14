import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconPanelLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { MAX_MERGED_HISTORY_TURNS } from "../protocol.js";
import { ChatHistoryPreview, } from "./ChatHistoryPreview.js";
import { GraphCanvas } from "./GraphCanvas.js";
import { contextReferences, hostCoordinates } from "./graph.js";
import { HistoryRail } from "./HistoryRail.js";
import { historyRailModel } from "./history-rail.js";
import { PAContextWindow } from "./PAContextWindow.js";
import { extractCompletedTurns } from "./extract.js";
import { projectLiveTurns } from "./live-turn.js";
import { nodeLabelMap } from "./labels.js";
import { localized, useLocale } from "./i18n.js";
import { useBusyAction } from "./use-busy-action.js";
import { useContextSelection } from "./use-context-selection.js";
import { useHistoryPreview } from "./use-history-preview.js";
import { useProjectGraph } from "./use-project-graph.js";
/**
 * Complete Branches workbench: graph selection, read-only history, and Merge.
 *
 * The component composes four pieces of state — the Workspace graph, the
 * Context selection, Chat History for that selection, and the action in
 * flight — and renders them. Each lives in its own hook.
 */
export function GraphView({ sessionId, useChat, useInput, inputActions, useGraph, syncTurns, adoptObservedGraph, loadProjectGraph, loadHistoryPreview, loadPreviewImage, tray, setComposerBlocked, activateAnchor, cancelAnchor, createMergedSession, persistenceError, }) {
    const locale = useLocale();
    // Narrow subscriptions: an assistant delta swaps only `partial`, so the
    // graph, the rail, and every settled Chat History section keep their
    // memoized render while the live tail streams.
    const nodes = useChat(value => value.legacy.nodes);
    const timeline = useChat(value => value.timeline);
    const partial = useChat(value => value.legacy.partial);
    const runningCalls = useChat(value => value.legacy.runningCalls);
    const input = useInput(value => value);
    const localState = useGraph((value) => value);
    const turns = useMemo(() => extractCompletedTurns({ nodes, chat: { timeline } }), [nodes, timeline]);
    const turnSignature = turns.map(turn => `${turn.turn}:${turn.boundarySeq}:${turn.answer.length}`).join('|');
    const [graphOpen, setGraphOpen] = useState(true);
    const [activeTrailId, setActiveTrailId] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [busy, runMerge] = useBusyAction(setActionError);
    const [anchorBusy, runAnchor] = useBusyAction(setActionError);
    const trayOwnerRef = useRef({});
    const project = useProjectGraph(String(sessionId), localState, loadProjectGraph, adoptObservedGraph);
    const state = project.model?.state ?? localState;
    const anchor = localState.anchors[String(sessionId)];
    const anchorActive = anchor !== undefined;
    const locked = busy || anchorBusy || anchorActive;
    // Declared after the adoption inside `useProjectGraph`, and held until the
    // first Workspace read has settled: the Workspace graph knows which of this
    // Chat's turns were copied from another Session, so adopting it first keeps
    // those copies from being numbered as PAs of their own. A failed or absent
    // Workspace read settles too, and the turns are then imported on their own.
    useEffect(() => {
        if (project.settled)
            syncTurns(turns);
    }, [turnSignature, syncTurns, project.settled]);
    const selection = useContextSelection(state, String(sessionId), anchor, locked);
    const { selectedIds, inspectedId } = selection;
    const labels = useMemo(() => nodeLabelMap(state), [state]);
    // Keep the node label currency paired with the exact sources sent to the
    // Host. If a stale graph reference cannot resolve, filtering the pair
    // together prevents every later PA label from shifting by one.
    const selectionRefs = contextReferences(state, selectedIds.filter(id => state.nodes[id] !== undefined), selection.sources);
    const previewEntries = useMemo(() => selectedIds.flatMap(nodeId => {
        const node = state.nodes[nodeId];
        return node === undefined ? [] : [{ nodeId, source: hostCoordinates(node) }];
    }), [selectedIds, state]);
    const previewNodeIds = useMemo(() => previewEntries.map(entry => entry.nodeId), [previewEntries]);
    // Only the Merge flight makes the official composer inert: the draft is being
    // transferred, and any edit during it aborts the transfer. A merely unmerged
    // Context keeps the composer typable — the composer-row guard refuses the
    // send gestures instead, so the draft can be written before the Merge.
    useEffect(() => {
        setComposerBlocked(busy || anchorBusy);
        return () => { setComposerBlocked(false); };
    }, [busy, anchorBusy, setComposerBlocked, locale]);
    const preview = useHistoryPreview(previewEntries, loadHistoryPreview, locale);
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
        if (selection.inspect(nodeId))
            setActionError(null);
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
    const discard = (send) => {
        const composerAvailable = setComposerBlocked(false);
        selection.reset(true);
        setActionError(send && !composerAvailable ? localized('来源 Session 仍被其他系统条件阻塞；Context 更改已放弃，请解除阻塞后使用官方输入框发送。', 'Another system condition still blocks the source Session. The context edits were discarded; resolve that block, then send with the official composer.', locale) : null);
        if (send && composerAvailable)
            inputActions.submit();
    };
    const merge = async () => {
        if (locked || selectedIds.length === 0)
            return;
        if (input.phase !== 'plain') {
            setActionError(localized('官方输入框正在处理另一项操作；请等待输入状态稳定后再 Merge。', 'The official composer is handling another operation. Wait for it to settle before merging.', locale));
            return;
        }
        if (selectedIds.length > MAX_MERGED_HISTORY_TURNS) {
            setActionError(localized(`单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`, `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale));
            return;
        }
        setActionError(null);
        await runMerge(async (signal) => {
            if (input.occurrences.length > 0) {
                throw new Error(localized('输入草稿包含 @ 引用或其他结构化 chip；请先移除或转换为普通文本再 Merge。', 'The draft contains @ references or other structured chips. Remove them or convert them to plain text before merging.', locale));
            }
            await createMergedSession(selectedIds, {
                contextRefs: contextReferences(state, selectedIds, selection.sources),
                text: input.draft,
                draftRevision: input.draftRev,
                attachmentIds: input.attachmentIds,
                hasStructuredReferences: false,
            }, signal);
        });
    };
    const toggleAnchor = async () => {
        if (busy || anchorBusy)
            return;
        setActionError(null);
        if (anchorActive) {
            await runAnchor(async (signal) => {
                await cancelAnchor(signal);
                selection.reset(false);
            });
            return;
        }
        if (selectedIds.length === 0 || selectedIds.length > MAX_MERGED_HISTORY_TURNS)
            return;
        await runAnchor(async (signal) => { await activateAnchor(selectedIds, signal); });
    };
    const inspected = inspectedId === null ? undefined : state.nodes[inspectedId];
    const inspectedSelected = inspectedId !== null && selectedIds.includes(inspectedId);
    // Memoized: the canvas re-lays out the whole tree whenever this object's
    // identity changes, which must not happen on every streamed delta.
    const canvasState = useMemo(() => ({
        ...state,
        headNodeId: selection.baselineIds.at(-1) ?? state.headNodeId,
        contextManifest: [],
    }), [state, selection.baselineIds]);
    const rail = useMemo(() => historyRailModel(state, {
        selectedIds,
        candidateId: null,
        headNodeId: canvasState.headNodeId,
        orderedIds: previewNodeIds,
    }), [state, selectedIds, canvasState.headNodeId, previewNodeIds]);
    useEffect(() => {
        if (activeTrailId !== null && !previewNodeIds.includes(activeTrailId))
            setActiveTrailId(null);
    }, [activeTrailId, previewNodeIds]);
    const draftHasContent = input.draft.trim() !== '' || input.attachmentIds.length > 0;
    const trayModel = {
        state,
        contextRefs: selectionRefs,
        selectedIds,
        orderedIds: selectedIds,
        candidateId: null,
        busy: busy || anchorBusy,
        anchored: anchorActive,
        anchorWorkspaceTitle: anchor?.workspaceTitle,
        error: actionError,
        dirty: selection.dirty,
        draftHasContent,
        overLimit: selectedIds.length > MAX_MERGED_HISTORY_TURNS,
        onMove: selection.move,
        onMoveEnd: selection.moveEnd,
        onRemove: selection.remove,
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
    return _jsxs("div", { className: "dsh-git-root", "data-conversation-composer-overlay": "", children: [persistenceError?.() ? _jsxs("div", { className: "dsh-git-error", role: "alert", children: [localized('图账本尚未保存，请重新加载页面：', 'Graph changes are not saved. Reload the page: ', locale), persistenceError()] }) : null, _jsxs("div", { className: `dsh-git-workbench ${graphOpen ? '' : 'dsh-git-workbench-graph-closed'}`, children: [graphOpen && _jsxs("div", { id: "dsh-git-conversation-graph", className: `dsh-git-branch-left ${inspected === undefined ? '' : 'dsh-git-branch-left-open'}`, children: [_jsxs("section", { className: "dsh-git-graph-panel", "aria-label": "Conversation Graph", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsx("span", { children: "Conversation Graph" }), _jsxs("span", { className: "dsh-git-legend", children: [project.error === null ? _jsxs(_Fragment, { children: [_jsx("span", { className: "dsh-git-legend-bar", "aria-hidden": "true" }), _jsx("span", { children: localized('已加入', 'Included', locale) })] }) : _jsx("span", { className: "dsh-git-muted", children: project.error }), _jsxs("button", { className: "dsh-git-anchor-button", "data-active": anchorActive ? '' : undefined, type: "button", "aria-pressed": anchorActive, disabled: anchorBusy || busy || (!anchorActive && selectedIds.length === 0), title: anchorActive
                                                            ? localized(`取消锚点；「${anchor.workspaceTitle}」会保留，再次锚定同一组 PA 时继续使用`, `Cancel anchor; “${anchor.workspaceTitle}” is kept and reused when the same PAs are anchored again`, locale)
                                                            : localized('固定蓝色 PA，并创建隔离的并列问题 Workspace', 'Fix the blue PAs and create an isolated Workspace for parallel questions', locale), onClick: () => { void toggleAnchor(); }, children: [_jsx("span", { "aria-hidden": "true", children: "\u2316" }), anchorBusy
                                                                ? localized('正在处理…', 'Working…', locale)
                                                                : anchorActive
                                                                    ? localized(`已锚定 ${anchor.nodeIds.length}`, `${anchor.nodeIds.length} anchored`, locale)
                                                                    : localized('锚定', 'Anchor', locale)] })] })] }), _jsx(GraphCanvas, { state: canvasState, previewNodeId: inspectedId, selectedNodeIds: selectedIds, candidateNodeId: null, anchoredNodeIds: anchor?.nodeIds, disabled: locked, onPreview: inspect })] }), inspected === undefined || inspectedId === null ? null : _jsx(PAContextWindow, { state: state, nodeId: inspectedId, label: labels.get(inspectedId) ?? 'PA', selected: inspectedSelected, disabled: locked, onAdd: selection.addInspected, onRemove: () => selection.remove(inspectedId), onClose: selection.closeInspector })] }), _jsxs("section", { className: "dsh-git-chat-panel", "aria-label": "Chat History", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsxs("span", { className: "dsh-git-heading-title", children: [_jsx("span", { children: "Chat History" }), _jsx("button", { className: "dsh-git-graph-toggle", type: "button", "aria-controls": "dsh-git-conversation-graph", "aria-expanded": graphOpen, "aria-label": graphOpen
                                                    ? localized('关闭 Conversation Graph', 'Close Conversation Graph', locale)
                                                    : localized('打开 Conversation Graph', 'Open Conversation Graph', locale), onClick: () => setGraphOpen(open => !open), children: _jsx(IconPanelLeftOutlineRegular, { size: 16 }) })] }), _jsxs("span", { className: "dsh-git-muted", children: [selectedIds.length, " ", localized('已加入', 'included', locale)] })] }), _jsxs("div", { className: `dsh-git-chat-body ${rail.entries.length === 0
                                    ? ''
                                    : graphOpen ? 'dsh-git-chat-body-rail' : 'dsh-git-chat-body-rail-expanded'}`, children: [_jsx(HistoryRail, { ...rail, disabled: busy || anchorBusy, expanded: !graphOpen, onSelect: jumpToHistory, onActiveChange: setActiveTrailId }), _jsx(ChatHistoryPreview, { response: preview.response, orderedNodeIds: previewNodeIds, labels: labels, candidateNodeId: null, activeNodeId: activeTrailId, pendingNodeIds: preview.pendingNodeIds, liveTurns: liveTurns, loading: preview.loading, error: preview.error, loadImage: loadPreviewImage })] })] })] })] });
}
//# sourceMappingURL=GraphView.js.map