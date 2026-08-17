import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { nodeHash, nodeLabelMap } from "./labels.js";
import { localized, useLocale } from "./i18n.js";
/**
 * Compact summary of one PA selection: number, title, hash, the Context that
 * answered it, and the explicit commit/remove action. The prompt and answer
 * bodies stay in Chat History rather than being repeated here.
 */
export function PAContextWindow({ state, nodeId, label, selected, disabled, onAdd, onRemove, onClose, }) {
    const locale = useLocale();
    const node = state.nodes[nodeId];
    if (node === undefined)
        return null;
    const labels = nodeLabelMap(state);
    return _jsxs("section", { id: "dsh-git-pa-context-window", className: "dsh-git-context-window", "aria-label": "PA Context Window", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsxs("span", { className: "dsh-git-heading-title", children: [_jsxs("span", { className: "dsh-git-heading-label", children: [label, " Context"] }), _jsx("code", { className: "dsh-git-heading-hash", title: node.id, children: nodeHash(node.id) })] }), _jsxs("span", { className: "dsh-git-heading-actions", children: [_jsx("button", { className: `dsh-git-button dsh-git-button-compact ${selected ? '' : 'dsh-git-button-primary'}`, type: "button", disabled: disabled, onClick: selected ? onRemove : onAdd, children: selected
                                    ? localized('移出 Context', 'Remove from Context', locale)
                                    : localized('加入 Context', 'Add to Context', locale) }), _jsx("button", { className: "dsh-git-close", type: "button", "aria-label": localized('关闭 PA Context Window', 'Close PA Context Window', locale), onClick: onClose, children: "\u00D7" })] })] }), _jsxs("div", { className: "dsh-git-inspector", children: [_jsx("h3", { children: node.prompt || localized('（无文字问题）', '(No text prompt)', locale) }), _jsxs("section", { className: "dsh-git-context-history", "aria-label": localized('回答时使用的 Context', 'Context used for this answer', locale), children: [_jsx("span", { className: "dsh-git-message-label", children: localized('回答时使用的 CONTEXT', 'CONTEXT USED FOR THIS ANSWER', locale) }), node.contextManifest.length === 0
                                ? _jsx("div", { className: "dsh-git-muted", children: localized('该节点没有前置 Context。', 'This node has no preceding Context.', locale) })
                                : _jsx("ol", { children: node.contextManifest.map(contextId => {
                                        const context = state.nodes[contextId];
                                        if (context === undefined)
                                            return null;
                                        return _jsxs("li", { children: [_jsx("strong", { children: labels.get(contextId) ?? nodeHash(contextId) }), _jsx("span", { children: context.prompt || localized('（无文字问题）', '(No text prompt)', locale) })] }, contextId);
                                    }) })] })] })] });
}
//# sourceMappingURL=PAContextWindow.js.map