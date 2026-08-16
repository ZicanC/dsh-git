import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useState } from 'react';
import { estimateTokens, joinsLineages } from "./graph.js";
import { nodeLabelMap } from "./labels.js";
import { localized, useLocale } from "./i18n.js";
/** Draggable ordered PA selection. The resident DSH composer remains below it. */
export function ContextTray({ state, selectedIds, orderedIds, candidateId, busy, error, dirty, overLimit, onMove, onMoveEnd, onRemove, onMerge, }) {
    const locale = useLocale();
    const [dragging, setDragging] = useState(null);
    const [expandedByUser, setExpandedByUser] = useState(false);
    const detailsId = useId();
    const selectionState = { ...state, contextManifest: selectedIds };
    const labels = nodeLabelMap(state);
    const previewId = candidateId === null || selectedIds.includes(candidateId) ? null : candidateId;
    // A selection that stays inside one Session branches it; only PAs from a
    // second Session make the new Chat a Merge. The preview counts, so the
    // action names what it would become.
    const action = joinsLineages(state, orderedIds) ? 'Merge' : 'Fork';
    const canMerge = !busy && !overLimit && selectedIds.length > 0 && candidateId === null;
    const forcedExpanded = dirty || candidateId !== null || error !== null;
    const expanded = forcedExpanded || expandedByUser;
    // Match the resident Todo dock: an inactive, clean context costs no layout.
    if (selectedIds.length === 0 && !forcedExpanded)
        return null;
    return _jsxs("section", { className: "dsh-git-tray", "aria-label": "Context Tray", children: [_jsxs("div", { className: "dsh-git-tray-head", children: [_jsxs("div", { className: "dsh-git-tray-summary", children: [_jsx("strong", { children: "Context Tray" }), _jsxs("span", { className: "dsh-git-muted dsh-git-tray-meta", children: [selectedIds.length, " PA", previewId === null ? '' : localized(' + 1 预览', ' + 1 preview', locale), ' · ', localized('约', 'About', locale), " ", estimateTokens(selectionState, selectedIds), " tokens"] })] }), _jsxs("div", { className: "dsh-git-tray-actions", children: [_jsx("button", { className: "dsh-git-button dsh-git-button-primary dsh-git-tray-merge", type: "button", disabled: !canMerge, title: candidateId !== null
                                    ? localized('请先加入或关闭绿色候选 PA。', 'Add or close the green candidate PA first.', locale)
                                    : overLimit
                                        ? localized(`所选 PA 数量超过单次 ${action} 上限。`, `The selection exceeds the per-${action} limit.`, locale)
                                        : action === 'Fork'
                                            ? localized('当前选择只来自一个 Session：新 Chat 是这条对话的 Fork。', 'The selection comes from one Session: the new Chat forks this conversation.', locale)
                                            : localized('当前选择来自多个 Session：新 Chat 会 Merge 这些 PA。', 'The selection spans Sessions: the new Chat merges those PAs.', locale), onClick: () => { void onMerge().catch(() => { }); }, children: busy ? localized('正在创建…', 'Creating…', locale) : action }), _jsx("button", { className: "dsh-git-tray-toggle", type: "button", "aria-controls": detailsId, "aria-expanded": expanded, "aria-label": expanded
                                    ? localized('收起 Context Tray', 'Collapse Context Tray', locale)
                                    : localized('展开 Context Tray', 'Expand Context Tray', locale), disabled: forcedExpanded, title: forcedExpanded
                                    ? localized('请先处理当前 Context 状态。', 'Resolve the current Context state first.', locale)
                                    : undefined, onClick: () => setExpandedByUser(value => !value), children: _jsx("span", { "aria-hidden": "true", children: expanded ? '⌄' : '⌃' }) })] })] }), expanded ? _jsxs("div", { className: "dsh-git-tray-details", id: detailsId, children: [orderedIds.length === 0 ? null : _jsx("div", { className: "dsh-git-chips", "aria-label": localized('已加入的 PA，拖动可调整合并顺序', 'Included PAs; drag to set merge order', locale), onDragOver: event => event.preventDefault(), onDrop: () => {
                            if (dragging !== null)
                                onMoveEnd(dragging);
                            setDragging(null);
                        }, children: orderedIds.map((nodeId, index) => {
                            const node = state.nodes[nodeId];
                            if (node === undefined)
                                return null;
                            const label = labels.get(nodeId) ?? 'PA';
                            const preview = nodeId === previewId;
                            return _jsxs("span", { className: preview ? 'dsh-git-chip dsh-git-chip-candidate' : 'dsh-git-chip', draggable: !busy, title: node.prompt, "data-preview": preview ? 'candidate' : undefined, onDragStart: (event) => {
                                    event.stopPropagation();
                                    setDragging(nodeId);
                                    event.dataTransfer.effectAllowed = 'move';
                                }, onDragEnd: () => setDragging(null), onDragOver: event => event.preventDefault(), onDrop: (event) => {
                                    event.stopPropagation();
                                    if (dragging !== null)
                                        onMove(dragging, nodeId);
                                    setDragging(null);
                                }, children: [_jsx("span", { "aria-hidden": "true", children: preview ? '⌁' : '⠿' }), label, preview ? _jsx("span", { className: "dsh-git-chip-tag", children: localized('预览', 'preview', locale) }) : null, _jsx("button", { type: "button", disabled: busy || index === 0, "aria-label": localized(`将 ${label} 向前移动`, `Move ${label} earlier`, locale), onClick: () => {
                                            const previousId = orderedIds[index - 1];
                                            if (previousId !== undefined)
                                                onMove(nodeId, previousId);
                                        }, children: "\u2039" }), _jsx("button", { type: "button", disabled: busy || index === orderedIds.length - 1, "aria-label": localized(`将 ${label} 向后移动`, `Move ${label} later`, locale), onClick: () => {
                                            const afterNextId = orderedIds[index + 2];
                                            if (afterNextId === undefined)
                                                onMoveEnd(nodeId);
                                            else
                                                onMove(nodeId, afterNextId);
                                        }, children: "\u203A" }), _jsx("button", { type: "button", disabled: busy, "aria-label": preview
                                            ? localized(`关闭 ${label} 预览`, `Close the ${label} preview`, locale)
                                            : localized(`移除 ${label}`, `Remove ${label}`, locale), onClick: () => onRemove(nodeId), children: "\u00D7" })] }, nodeId);
                        }) }), error === null ? null : _jsx("div", { className: "dsh-git-error", role: "alert", children: error })] }) : null] });
}
//# sourceMappingURL=ContextTray.js.map