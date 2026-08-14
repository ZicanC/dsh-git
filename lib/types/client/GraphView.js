import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { extractCompletedTurns } from "./extract.js";
import { ContextTray } from "./ContextTray.js";
import { GraphCanvas } from "./GraphCanvas.js";
import { nodeHash, nodeLabelMap } from "./labels.js";
import { localized, useLocale } from "./i18n.js";
function BranchControls({ branchId, name, current, onCheckout, onRename, locale, }) {
    const [draft, setDraft] = useState(name);
    const commit = () => {
        const normalized = draft.trim();
        if (normalized === '')
            setDraft(name);
        else
            onRename(branchId, normalized);
    };
    return _jsxs("div", { className: "dsh-git-inspector-actions", children: [_jsx("input", { className: "dsh-git-branch-name", "aria-label": localized('Branch 名称', 'Branch name', locale), value: draft, onChange: event => setDraft(event.target.value), onBlur: commit, onKeyDown: (event) => {
                    if (event.key === 'Enter')
                        event.currentTarget.blur();
                    if (event.key === 'Escape') {
                        setDraft(name);
                        event.currentTarget.blur();
                    }
                } }), _jsx("button", { className: "dsh-git-button", type: "button", disabled: current, onClick: onCheckout, children: current ? localized('当前 HEAD', 'Current HEAD', locale) : localized('切换到此分支', 'Switch to this branch', locale) })] });
}
/** Complete graph view registered as one conversation tab. */
export function GraphView({ useSession, useGraph, syncTurns, toggleContext, moveContext, moveContextToEnd, clearContext, checkout, renameBranch, ask, }) {
    const locale = useLocale();
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
    const labels = useMemo(() => nodeLabelMap(state), [state]);
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
    return _jsxs("div", { className: "dsh-git-root", "data-conversation-composer-overlay": "", children: [_jsxs("div", { className: `dsh-git-workbench ${inspected === undefined ? '' : 'dsh-git-workbench-open'}`, children: [_jsxs("section", { className: "dsh-git-panel", "aria-label": "Conversation Graph", children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsx("span", { children: "Conversation Graph" }), _jsx("span", { className: "dsh-git-muted", children: localized('点击节点查看 Context · 虚线为 merge', 'Click a node to view Context · dashed lines are merges', locale) })] }), _jsx(GraphCanvas, { state: state, previewNodeId: inspectedNodeId, onPreview: setInspectedNodeId })] }), inspected === undefined ? null : _jsxs("aside", { className: "dsh-git-panel", "aria-label": localized('节点 Context', 'Node Context', locale), children: [_jsxs("header", { className: "dsh-git-heading", children: [_jsxs("span", { children: [labels.get(inspected.id) ?? 'PA', " Context"] }), _jsx("button", { className: "dsh-git-close", type: "button", "aria-label": localized('关闭节点 Context', 'Close Node Context', locale), onClick: () => setInspectedNodeId(null), children: "\u00D7" })] }), _jsxs("div", { className: "dsh-git-inspector", children: [_jsx("h3", { children: inspected.prompt || localized('（无文字问题）', '(No text prompt)', locale) }), _jsxs("div", { className: "dsh-git-node-hash", children: [_jsx("span", { children: "HASH" }), _jsx("code", { children: nodeHash(inspected.id) })] }), inspectedBranch === undefined ? null : _jsx(BranchControls, { branchId: inspectedBranch.id, name: inspectedBranch.name, current: inspected.id === state.headNodeId, locale: locale, onCheckout: () => checkout(inspected.id), onRename: renameBranch }, inspectedBranch.id), _jsx("button", { className: "dsh-git-button", type: "button", onClick: () => toggleContext(inspected.id), children: state.contextManifest.includes(inspected.id) ? localized('从 Context Tray 移除', 'Remove from Context Tray', locale) : localized('加入 Context Tray', 'Add to Context Tray', locale) }), _jsxs("section", { className: "dsh-git-context-history", "aria-label": localized('回答时使用的 Context', 'Context used for this answer', locale), children: [_jsx("span", { className: "dsh-git-message-label", children: localized('回答时使用的 CONTEXT', 'CONTEXT USED FOR THIS ANSWER', locale) }), inspected.contextManifest.length === 0
                                                ? _jsx("div", { className: "dsh-git-muted", children: localized('该节点没有前置 Context。', 'This node has no preceding Context.', locale) })
                                                : _jsx("ol", { children: inspected.contextManifest.map(nodeId => {
                                                        const contextNode = state.nodes[nodeId];
                                                        if (contextNode === undefined)
                                                            return null;
                                                        return _jsxs("li", { children: [_jsx("strong", { children: labels.get(nodeId) ?? 'PA' }), _jsx("span", { children: contextNode.prompt || localized('（无文字问题）', '(No text prompt)', locale) })] }, nodeId);
                                                    }) })] }), _jsxs("div", { className: "dsh-git-message", children: [_jsx("span", { className: "dsh-git-message-label", children: "PROMPT" }), _jsx(MarkdownText, { text: inspected.prompt || localized('（无文字问题）', '(No text prompt)', locale) })] }), _jsxs("div", { className: "dsh-git-message", children: [_jsx("span", { className: "dsh-git-message-label", children: "ANSWER" }), _jsx(MarkdownText, { text: inspected.answer || localized('（没有文字回答）', '(No text answer)', locale) })] }), _jsxs("div", { className: "dsh-git-muted", children: [localized('父节点', 'parents', locale), ": ", inspected.parentIds.length || 0, " \u00B7 context: ", inspected.contextManifest.length || 0] })] })] })] }), _jsx(ContextTray, { state: state, busy: busy, error: error, onMove: moveContext, onMoveEnd: moveContextToEnd, onRemove: toggleContext, onClear: clearContext, onAsk: submit })] });
}
//# sourceMappingURL=GraphView.js.map