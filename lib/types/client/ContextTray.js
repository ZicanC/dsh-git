import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { estimateTokens, missingDirectDependencies } from "./graph.js";
function shortId(id) {
    return id.startsWith('pa-') ? `PA-${id.slice(-5)}` : id.slice(-8);
}
/** Draggable ordered context selection and branch-creating prompt composer. */
export function ContextTray({ state, busy, error, onMove, onMoveEnd, onRemove, onClear, onAsk, }) {
    const [question, setQuestion] = useState('');
    const [dragging, setDragging] = useState(null);
    const missing = missingDirectDependencies(state, state.contextManifest);
    const canAsk = !busy && question.trim() !== '' && state.contextManifest.length > 0;
    const submit = async () => {
        if (!canAsk)
            return;
        await onAsk(question);
        setQuestion('');
    };
    return _jsxs("section", { className: "dsh-git-tray", "aria-label": "Context Tray", children: [_jsxs("div", { className: "dsh-git-tray-head", children: [_jsx("strong", { children: "Context Tray" }), _jsxs("span", { className: "dsh-git-muted", children: ["\u7EA6 ", estimateTokens(state, state.contextManifest), " tokens \u00B7 \u53EF\u62D6\u52A8\u6392\u5E8F"] })] }), _jsx("div", { className: "dsh-git-chips", onDragOver: event => event.preventDefault(), onDrop: () => {
                    if (dragging !== null)
                        onMoveEnd(dragging);
                    setDragging(null);
                }, children: state.contextManifest.length === 0
                    ? _jsx("span", { className: "dsh-git-muted", children: "\u5728\u4E0A\u65B9\u5206\u53C9\u56FE\u4E2D\u52FE\u9009 PA \u8282\u70B9" })
                    : state.contextManifest.map((nodeId) => {
                        const node = state.nodes[nodeId];
                        if (node === undefined)
                            return null;
                        return _jsxs("span", { className: "dsh-git-chip", draggable: true, title: node.prompt, onDragStart: (event) => {
                                event.stopPropagation();
                                setDragging(nodeId);
                                event.dataTransfer.effectAllowed = 'move';
                            }, onDragOver: event => event.preventDefault(), onDrop: (event) => {
                                event.stopPropagation();
                                if (dragging !== null)
                                    onMove(dragging, nodeId);
                                setDragging(null);
                            }, children: [_jsx("span", { "aria-hidden": "true", children: "\u283F" }), shortId(nodeId), _jsx("button", { type: "button", "aria-label": `移除 ${shortId(nodeId)}`, onClick: () => onRemove(nodeId), children: "\u00D7" })] }, nodeId);
                    }) }), missing.length > 0
                ? _jsxs("div", { className: "dsh-git-warning", children: ["\u81EA\u7531\u9009\u62E9\u6A21\u5F0F\uFF1A", missing.map(shortId).join('、'), " \u672A\u52A0\u5165\uFF1B\u6A21\u578B\u53EA\u63A5\u6536 Tray \u4E2D\u5217\u51FA\u7684 PA\u3002"] })
                : null, _jsx("textarea", { className: "dsh-git-question", value: question, disabled: busy, placeholder: "\u8F93\u5165\u4E0B\u4E00\u4E2A\u95EE\u9898\uFF1B\u63D0\u4EA4\u540E\u4F1A\u81EA\u52A8\u5EFA\u7ACB\u65B0\u7684 merge branch\u2026", onChange: event => setQuestion(event.target.value), onKeyDown: (event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void submit().catch(() => { });
                    }
                } }), error === null ? null : _jsx("div", { className: "dsh-git-error", role: "alert", children: error }), _jsxs("div", { className: "dsh-git-actions", children: [_jsx("button", { className: "dsh-git-button", type: "button", disabled: busy || state.contextManifest.length === 0, onClick: onClear, children: "\u6E05\u7A7A" }), _jsx("button", { className: "dsh-git-button dsh-git-button-primary", type: "button", disabled: !canAsk, onClick: () => { void submit().catch(() => { }); }, children: busy ? '正在创建 branch…' : '创建 merge branch 并提问 →' })] })] });
}
//# sourceMappingURL=ContextTray.js.map