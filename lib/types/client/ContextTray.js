import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { estimateTokens, missingDirectDependencies } from "./graph.js";
import { nodeLabelMap } from "./labels.js";
import { localized, useLocale } from "./i18n.js";
/** Draggable ordered context selection and branch-creating prompt composer. */
export function ContextTray({ state, busy, error, onMove, onMoveEnd, onRemove, onClear, onAsk, }) {
    const locale = useLocale();
    const [question, setQuestion] = useState('');
    const [dragging, setDragging] = useState(null);
    const missing = missingDirectDependencies(state, state.contextManifest);
    const labels = nodeLabelMap(state);
    const canAsk = !busy && question.trim() !== '' && state.contextManifest.length > 0;
    const submit = async () => {
        if (!canAsk)
            return;
        await onAsk(question);
        setQuestion('');
    };
    return _jsxs("section", { className: "dsh-git-tray", "aria-label": "Context Tray", children: [_jsxs("div", { className: "dsh-git-tray-head", children: [_jsx("strong", { children: "Context Tray" }), _jsxs("span", { className: "dsh-git-muted", children: [localized('约', 'About', locale), " ", estimateTokens(state, state.contextManifest), " tokens \u00B7 ", localized('可拖动排序', 'drag to reorder', locale)] })] }), _jsx("div", { className: "dsh-git-chips", onDragOver: event => event.preventDefault(), onDrop: () => {
                    if (dragging !== null)
                        onMoveEnd(dragging);
                    setDragging(null);
                }, children: state.contextManifest.length === 0
                    ? _jsx("span", { className: "dsh-git-muted", children: localized('在上方分叉图中勾选 PA 节点', 'Select PA nodes in the graph above', locale) })
                    : state.contextManifest.map((nodeId) => {
                        const node = state.nodes[nodeId];
                        if (node === undefined)
                            return null;
                        const label = labels.get(nodeId) ?? 'PA';
                        return _jsxs("span", { className: "dsh-git-chip", draggable: true, title: node.prompt, onDragStart: (event) => {
                                event.stopPropagation();
                                setDragging(nodeId);
                                event.dataTransfer.effectAllowed = 'move';
                            }, onDragOver: event => event.preventDefault(), onDrop: (event) => {
                                event.stopPropagation();
                                if (dragging !== null)
                                    onMove(dragging, nodeId);
                                setDragging(null);
                            }, children: [_jsx("span", { "aria-hidden": "true", children: "\u283F" }), label, _jsx("button", { type: "button", "aria-label": localized(`移除 ${label}`, `Remove ${label}`, locale), onClick: () => onRemove(nodeId), children: "\u00D7" })] }, nodeId);
                    }) }), missing.length > 0
                ? _jsx("div", { className: "dsh-git-warning", children: localized(`自由选择模式：${missing.map(id => labels.get(id) ?? 'PA').join('、')} 未加入；模型只接收 Tray 中列出的 PA。`, `Free selection: ${missing.map(id => labels.get(id) ?? 'PA').join(', ')} not included; the model receives only the PAs listed in the Tray.`, locale) })
                : null, _jsx("textarea", { className: "dsh-git-question", value: question, disabled: busy, placeholder: localized('输入下一个问题；提交后会自动建立新的 merge branch…', 'Enter your next question; submitting creates a new merge branch…', locale), onChange: event => setQuestion(event.target.value), onKeyDown: (event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void submit().catch(() => { });
                    }
                } }), error === null ? null : _jsx("div", { className: "dsh-git-error", role: "alert", children: error }), _jsxs("div", { className: "dsh-git-actions", children: [_jsx("button", { className: "dsh-git-button", type: "button", disabled: busy || state.contextManifest.length === 0, onClick: onClear, children: localized('清空', 'Clear', locale) }), _jsx("button", { className: "dsh-git-button dsh-git-button-primary", type: "button", disabled: !canAsk, onClick: () => { void submit().catch(() => { }); }, children: busy ? localized('正在创建 branch…', 'Creating branch…', locale) : localized('创建 merge branch 并提问 →', 'Create merge branch and ask →', locale) })] })] });
}
//# sourceMappingURL=ContextTray.js.map