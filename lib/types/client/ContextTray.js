import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { estimateTokens, missingDirectDependencies } from "./graph.js";
import { nodeLabelMap } from "./labels.js";
import { localized, useLocale } from "./i18n.js";
/** Draggable ordered PA selection. The resident DSH composer remains below it. */
export function ContextTray({ state, selectedIds, candidateId, busy, error, dirty, draftHasContent, overLimit, onMove, onMoveEnd, onRemove, onClear, onMerge, onDiscard, }) {
    const locale = useLocale();
    const [dragging, setDragging] = useState(null);
    const selectionState = { ...state, contextManifest: selectedIds };
    const missing = missingDirectDependencies(selectionState, selectedIds);
    const labels = nodeLabelMap(state);
    const canMerge = !busy && !overLimit && selectedIds.length > 0 && candidateId === null;
    return _jsxs("section", { className: "dsh-git-tray", "aria-label": "Context Tray", children: [_jsxs("div", { className: "dsh-git-tray-head", children: [_jsxs("div", { children: [_jsx("strong", { children: "Context Tray" }), _jsxs("span", { className: "dsh-git-muted dsh-git-tray-meta", children: [localized('约', 'About', locale), " ", estimateTokens(selectionState, selectedIds), " tokens \u00B7 ", localized('拖动 PA 调整合并顺序', 'drag PAs to set merge order', locale)] })] }), _jsx("button", { className: "dsh-git-button dsh-git-button-primary", type: "button", disabled: !canMerge, title: candidateId !== null
                            ? localized('请先加入或关闭绿色候选 PA。', 'Add or close the green candidate PA first.', locale)
                            : overLimit
                                ? localized('所选 PA 数量超过单次 Merge 上限。', 'The selection exceeds the per-Merge limit.', locale)
                                : undefined, onClick: () => { void onMerge().catch(() => { }); }, children: busy ? localized('正在创建 Chat…', 'Creating Chat…', locale) : 'Merge' })] }), _jsx("div", { className: "dsh-git-chips", onDragOver: event => event.preventDefault(), onDrop: () => {
                    if (dragging !== null)
                        onMoveEnd(dragging);
                    setDragging(null);
                }, children: selectedIds.length === 0
                    ? _jsx("span", { className: "dsh-git-muted", children: localized('还没有正式加入的 PA。', 'No PAs have been added yet.', locale) })
                    : selectedIds.map((nodeId, index) => {
                        const node = state.nodes[nodeId];
                        if (node === undefined)
                            return null;
                        const label = labels.get(nodeId) ?? 'PA';
                        return _jsxs("span", { className: "dsh-git-chip", draggable: !busy, title: node.prompt, onDragStart: (event) => {
                                event.stopPropagation();
                                setDragging(nodeId);
                                event.dataTransfer.effectAllowed = 'move';
                            }, onDragEnd: () => setDragging(null), onDragOver: event => event.preventDefault(), onDrop: (event) => {
                                event.stopPropagation();
                                if (dragging !== null)
                                    onMove(dragging, nodeId);
                                setDragging(null);
                            }, children: [_jsx("span", { "aria-hidden": "true", children: "\u283F" }), label, _jsx("button", { type: "button", disabled: busy || index === 0, "aria-label": localized(`将 ${label} 向前移动`, `Move ${label} earlier`, locale), onClick: () => {
                                        const previousId = selectedIds[index - 1];
                                        if (previousId !== undefined)
                                            onMove(nodeId, previousId);
                                    }, children: "\u2039" }), _jsx("button", { type: "button", disabled: busy || index === selectedIds.length - 1, "aria-label": localized(`将 ${label} 向后移动`, `Move ${label} later`, locale), onClick: () => {
                                        const afterNextId = selectedIds[index + 2];
                                        if (afterNextId === undefined)
                                            onMoveEnd(nodeId);
                                        else
                                            onMove(nodeId, afterNextId);
                                    }, children: "\u203A" }), _jsx("button", { type: "button", disabled: busy, "aria-label": localized(`移除 ${label}`, `Remove ${label}`, locale), onClick: () => onRemove(nodeId), children: "\u00D7" })] }, nodeId);
                    }) }), candidateId === null ? null : _jsx("div", { className: "dsh-git-candidate-note", role: "status", children: localized('绿色 PA 只是虚线预览；请在 PA Context Window 中选择“加入 Context”，或关闭预览。', 'The green PA is only a dashed preview; add it from the PA Context Window or close the preview.', locale) }), missing.length > 0
                ? _jsx("div", { className: "dsh-git-warning", children: localized(`自由选择模式：${missing.map(id => labels.get(id) ?? 'PA').join('、')} 未加入；新 Chat 只包含 Tray 中列出的 PA。`, `Free selection: ${missing.map(id => labels.get(id) ?? 'PA').join(', ')} not included; the new Chat contains only the PAs listed in the Tray.`, locale) })
                : null, dirty ? _jsxs("div", { className: "dsh-git-merge-guard", role: "status", children: [_jsx("span", { children: localized('Context 有未 Merge 的更改。官方输入框已暂停，以免发送到原 Session。', 'Context has unmerged changes. The official composer is paused to avoid sending to the source Session.', locale) }), _jsx("button", { className: "dsh-git-button", type: "button", disabled: busy, onClick: () => onDiscard(draftHasContent), children: draftHasContent
                            ? localized('放弃更改并发送原会话', 'Discard changes and send to source', locale)
                            : localized('放弃更改', 'Discard changes', locale) })] }) : null, error === null ? null : _jsx("div", { className: "dsh-git-error", role: "alert", children: error }), _jsxs("div", { className: "dsh-git-tray-footer", children: [_jsx("button", { className: "dsh-git-button", type: "button", disabled: busy || selectedIds.length === 0, onClick: onClear, children: localized('清空', 'Clear', locale) }), _jsx("span", { className: "dsh-git-muted", children: localized('Merge 只创建新 Chat；消息仍由下方官方输入框发送。', 'Merge only creates a new Chat; messages are still sent by the official composer below.', locale) })] })] });
}
//# sourceMappingURL=ContextTray.js.map