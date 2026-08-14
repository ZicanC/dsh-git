import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { extractCompletedTurns } from "./extract.js";
import { ContextTray } from "./ContextTray.js";
import { GraphCanvas } from "./GraphCanvas.js";
function BranchControls({ branchId, name, current, onCheckout, onRename, }) {
    const [draft, setDraft] = useState(name);
    const commit = () => {
        const normalized = draft.trim();
        if (normalized === '')
            setDraft(name);
        else
            onRename(branchId, normalized);
    };
    return _jsxs("div", { className: "dsh-git-inspector-actions", children: [_jsx("input", { className: "dsh-git-branch-name", "aria-label": "Branch \u540D\u79F0", value: draft, onChange: event => setDraft(event.target.value), onBlur: commit, onKeyDown: (event) => {
                    if (event.key === 'Enter')
                        event.currentTarget.blur();
                    if (event.key === 'Escape') {
                        setDraft(name);
                        event.currentTarget.blur();
                    }
                } }), _jsx("button", { className: "dsh-git-button", type: "button", disabled: current, onClick: onCheckout, children: current ? '当前 HEAD' : '切换到此分支' })] });
}
/** Complete graph view registered as one conversation tab. */
export function GraphView({ useSession, useGraph, syncTurns, toggleContext, moveContext, moveContextToEnd, clearContext, checkout, renameBranch, ask, }) {
    const snapshot = useSession(value => value);
    const state = useGraph((value) => value);
    const turns = useMemo(() => extractCompletedTurns(snapshot), [snapshot]);
    const signature = turns.map(turn => `${turn.turn}:${turn.boundarySeq}:${turn.answer.length}`).join('|');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [inspectedNodeId, setInspectedNodeId] = useState(null);
    useEffect(() => { syncTurns(turns); }, [signature, syncTurns]);
    const inspected = inspectedNodeId === null ? undefined : state.nodes[inspectedNodeId];
    const inspectedBranch = inspected === undefined ? undefined : state.branches[inspected.branchId];
    const labels = useMemo(() => new Map(Object.values(state.nodes)
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
        .map((node, index) => [node.id, `PA${index + 1}`])), [state.nodes]);
    const submit = async (question) => {
        setBusy(true);
        setError(null);
        try {
            await ask(question, state.contextManifest);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            throw cause;
        }
        finally {
            setBusy(false);
        }
    };
    return _jsxs("div", { className: "dsh-git-root", "data-conversation-composer-overlay": "", children: [_jsxs("div", { className: `dsh-git-workbench ${inspected === undefined ? '' : 'dsh-git-workbench-open'}`, children: [_jsxs("section", { className: "dsh-git-panel", "aria-label": "Conversation Graph", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsx("span", { children: "Conversation Graph" }), _jsx("span", { className: "dsh-git-muted", children: "\u70B9\u51FB\u8282\u70B9\u67E5\u770B Context \u00B7 \u865A\u7EBF\u4E3A merge" })] }), _jsx(GraphCanvas, { state: state, previewNodeId: inspectedNodeId, onPreview: setInspectedNodeId })] }), inspected === undefined ? null : _jsxs("aside", { className: "dsh-git-panel", "aria-label": "\u8282\u70B9 Context", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsxs("span", { children: [labels.get(inspected.id) ?? 'PA', " Context"] }), _jsx("button", { className: "dsh-git-close", type: "button", "aria-label": "\u5173\u95ED\u8282\u70B9 Context", onClick: () => setInspectedNodeId(null), children: "\u00D7" })] }), _jsxs("div", { className: "dsh-git-inspector", children: [_jsx("h3", { children: inspected.prompt || '（无文字问题）' }), inspectedBranch === undefined ? null : _jsx(BranchControls, { branchId: inspectedBranch.id, name: inspectedBranch.name, current: inspected.id === state.headNodeId, onCheckout: () => checkout(inspected.id), onRename: renameBranch }, inspectedBranch.id), _jsx("button", { className: "dsh-git-button", type: "button", onClick: () => toggleContext(inspected.id), children: state.contextManifest.includes(inspected.id) ? '从 Context Tray 移除' : '加入 Context Tray' }), _jsxs("section", { className: "dsh-git-context-history", "aria-label": "\u56DE\u7B54\u65F6\u4F7F\u7528\u7684 Context", children: [_jsx("span", { className: "dsh-git-message-label", children: "\u56DE\u7B54\u65F6\u4F7F\u7528\u7684 CONTEXT" }), inspected.contextManifest.length === 0
                                                ? _jsx("div", { className: "dsh-git-muted", children: "\u8BE5\u8282\u70B9\u6CA1\u6709\u524D\u7F6E Context\u3002" })
                                                : _jsx("ol", { children: inspected.contextManifest.map(nodeId => {
                                                        const contextNode = state.nodes[nodeId];
                                                        if (contextNode === undefined)
                                                            return null;
                                                        return _jsxs("li", { children: [_jsx("strong", { children: labels.get(nodeId) ?? 'PA' }), _jsx("span", { children: contextNode.prompt || '（无文字问题）' })] }, nodeId);
                                                    }) })] }), _jsxs("div", { className: "dsh-git-message", children: [_jsx("span", { className: "dsh-git-message-label", children: "PROMPT" }), inspected.prompt] }), _jsxs("div", { className: "dsh-git-message", children: [_jsx("span", { className: "dsh-git-message-label", children: "ANSWER" }), inspected.answer || '（没有文字回答）'] }), _jsxs("div", { className: "dsh-git-muted", children: ["parents: ", inspected.parentIds.length || 0, " \u00B7 context: ", inspected.contextManifest.length || 0] })] })] })] }), _jsx(ContextTray, { state: state, busy: busy, error: error, onMove: moveContext, onMoveEnd: moveContextToEnd, onRemove: toggleContext, onClear: clearContext, onAsk: submit })] });
}
//# sourceMappingURL=GraphView.js.map