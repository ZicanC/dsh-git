import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Project-level Conversation Graph takeover page with a Fusion-style PA timeline. */
import { useEffect, useMemo, useState } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { GraphCanvas } from "./GraphCanvas.js";
import { assembleProjectGraph, projectGraphAt } from "./project-graph.js";
import { localized, useLocale } from "./i18n.js";
function formatTime(time, locale) {
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(time));
}
/** Full takeover page mounted by the sidebar compatibility bridge. */
export function ProjectGraphPage({ workspaceId, workspaceTitle, sessionTitles, load, getLocalState, onClose, onOpenSession, }) {
    const locale = useLocale();
    const [model, setModel] = useState(null);
    const [error, setError] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [cursor, setCursor] = useState(1);
    const [inspectedId, setInspectedId] = useState(null);
    useEffect(() => {
        const controller = new AbortController();
        setError(null);
        load(controller.signal).then((response) => {
            if (controller.signal.aborted)
                return;
            const next = assembleProjectGraph(response, getLocalState(), sessionTitles);
            setModel(next);
            setCursor(Math.max(1, next.timeline.length));
            setInspectedId(null);
        }).catch((cause) => {
            if (controller.signal.aborted)
                return;
            setError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => { controller.abort(); };
    }, [workspaceId, refreshKey, load, getLocalState, sessionTitles]);
    useEffect(() => {
        const close = (event) => { if (event.key === 'Escape')
            onClose(); };
        window.addEventListener('keydown', close);
        return () => { window.removeEventListener('keydown', close); };
    }, [onClose]);
    const labels = useMemo(() => {
        const result = new Map(model?.timeline.map((id, index) => [id, `PA${index + 1}`]) ?? []);
        if (model === null)
            return result;
        for (const node of Object.values(model.nodes)) {
            if (node.forkSourceId === undefined)
                continue;
            result.set(node.id, `${result.get(node.forkSourceId) ?? 'PA'} fork`);
        }
        return result;
    }, [model]);
    const nodeColors = useMemo(() => {
        const colors = new Map();
        if (model === null)
            return colors;
        const sessions = new Map();
        const nodes = Object.values(model.nodes).sort((left, right) => left.sessionCreatedAt - right.sessionCreatedAt || left.id.localeCompare(right.id));
        for (const node of nodes) {
            if (!sessions.has(node.sessionId))
                sessions.set(node.sessionId, sessions.size % 8);
            colors.set(node.id, sessions.get(node.sessionId));
        }
        return colors;
    }, [model]);
    const visible = model === null || model.timeline.length === 0 ? null : projectGraphAt(model, cursor);
    const selectedId = model?.timeline[Math.max(0, cursor - 1)];
    const selected = selectedId === undefined ? undefined : model?.nodes[selectedId];
    const inspected = inspectedId === null ? undefined : model?.nodes[inspectedId];
    return _jsxs("div", { className: "dsh-git-project-page", role: "dialog", "aria-label": `${workspaceTitle} Conversation Graph`, children: [_jsxs("header", { className: "dsh-git-project-header", children: [_jsxs("div", { children: [_jsx("h1", { children: workspaceTitle }), _jsx("span", { children: "Conversation Graph" })] }), _jsxs("div", { className: "dsh-git-project-summary", children: [_jsxs("span", { children: [model?.sessionCount ?? 0, " Sessions"] }), _jsxs("span", { children: [model?.timeline.length ?? 0, " PA"] }), _jsx("button", { type: "button", onClick: () => { setModel(null); setRefreshKey(value => value + 1); }, children: localized('刷新', 'Refresh', locale) }), _jsx("button", { type: "button", "aria-label": localized('关闭项目 Conversation Graph', 'Close project Conversation Graph', locale), onClick: onClose, children: "\u00D7" })] })] }), model === null
                ? _jsxs("main", { className: "dsh-git-project-status", role: error === null ? 'status' : 'alert', children: [_jsx("p", { children: error ?? localized('正在读取项目中的全部 Session…', 'Loading all Sessions in this project…', locale) }), error === null ? null : _jsx("button", { type: "button", onClick: () => { setModel(null); setRefreshKey(value => value + 1); }, children: localized('重试', 'Retry', locale) })] })
                : model.timeline.length === 0
                    ? _jsx("main", { className: "dsh-git-project-status", children: _jsx("p", { children: localized('这个项目还没有已完成的 PA。', 'This project has no completed PAs yet.', locale) }) })
                    : _jsxs("main", { className: `dsh-git-project-main ${inspected === undefined ? '' : 'dsh-git-project-main-open'}`, children: [_jsx("section", { className: "dsh-git-project-canvas", "aria-label": localized('项目 Conversation Graph', 'Project Conversation Graph', locale), children: _jsx(GraphCanvas, { state: visible, previewNodeId: inspectedId, onPreview: setInspectedId, labels: labels, nodeColors: nodeColors, fit: false }) }), inspected === undefined ? null : _jsxs("aside", { className: "dsh-git-project-inspector", "aria-label": localized('项目 PA 详情', 'Project PA details', locale), children: [_jsxs("header", { children: [_jsxs("strong", { children: [labels.get(inspected.id) ?? 'PA', " \u00B7 ", inspected.sessionTitle] }), _jsx("button", { type: "button", "aria-label": localized('关闭 PA 详情', 'Close PA details', locale), onClick: () => setInspectedId(null), children: "\u00D7" })] }), _jsxs("div", { className: "dsh-git-project-inspector-body", children: [_jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "Session" }), _jsx("dd", { children: inspected.sessionTitle })] }), _jsxs("div", { children: [_jsx("dt", { children: "Session ID" }), _jsx("dd", { children: _jsx("code", { children: inspected.sessionId }) })] }), _jsxs("div", { children: [_jsx("dt", { children: localized('轮次', 'Turn', locale) }), _jsx("dd", { children: inspected.turn })] }), _jsxs("div", { children: [_jsx("dt", { children: localized('PA 完成', 'PA completed', locale) }), _jsx("dd", { children: formatTime(inspected.completedAt, locale) })] }), _jsxs("div", { children: [_jsx("dt", { children: localized('Session 创建', 'Session created', locale) }), _jsx("dd", { children: formatTime(inspected.sessionCreatedAt, locale) })] })] }), _jsxs("section", { className: "dsh-git-message", children: [_jsx("span", { className: "dsh-git-message-label", children: "PROMPT" }), _jsx(MarkdownText, { text: inspected.prompt || localized('（无文字问题）', '(No text prompt)', locale) })] }), _jsxs("section", { className: "dsh-git-message", children: [_jsx("span", { className: "dsh-git-message-label", children: "ANSWER" }), _jsx(MarkdownText, { text: inspected.answer || localized('（没有文字回答）', '(No text answer)', locale) })] }), _jsxs("section", { className: "dsh-git-context-history", children: [_jsx("span", { className: "dsh-git-message-label", children: "CONTEXT" }), inspected.contextManifest.length === 0
                                                        ? _jsx("span", { className: "dsh-git-muted", children: localized('没有前置 Context', 'No preceding Context', locale) })
                                                        : _jsx("ol", { children: inspected.contextManifest.map(id => _jsx("li", { children: labels.get(id) ?? id }, id)) })] }), _jsx("button", { className: "dsh-git-button dsh-git-button-primary", type: "button", onClick: () => onOpenSession(inspected.sessionId), children: localized('打开原会话', 'Open source Session', locale) })] })] })] }), model === null || model.timeline.length === 0 ? null : _jsxs("footer", { className: "dsh-git-timeline", "aria-label": localized('PA 时间轴', 'PA timeline', locale), children: [_jsxs("div", { className: "dsh-git-timeline-readout", children: [_jsx("strong", { children: labels.get(selectedId) }), _jsx("span", { children: selected?.sessionTitle }), _jsx("time", { children: selected === undefined ? '' : formatTime(selected.completedAt, locale) })] }), _jsxs("div", { className: "dsh-git-timeline-controls", children: [_jsx("button", { type: "button", "aria-label": localized('上一个 PA', 'Previous PA', locale), disabled: cursor <= 1, onClick: () => setCursor(value => Math.max(1, value - 1)), children: "\u2039" }), _jsxs("div", { className: "dsh-git-timeline-track", children: [_jsx("div", { className: "dsh-git-timeline-session-marks", "aria-hidden": "true", children: model.timeline.map((id, index) => model.nodes[id]?.firstInSession
                                            ? _jsx("span", { style: { left: `${model.timeline.length === 1 ? 0 : index / (model.timeline.length - 1) * 100}%` } }, id)
                                            : null) }), _jsx("input", { type: "range", min: 1, max: model.timeline.length, step: 1, value: cursor, "aria-label": localized('PA 时间轴游标', 'PA timeline cursor', locale), "aria-valuetext": `${labels.get(selectedId)} ${selected?.sessionTitle ?? ''}`, onChange: event => { setCursor(Number(event.currentTarget.value)); setInspectedId(null); } })] }), _jsx("button", { type: "button", "aria-label": localized('下一个 PA', 'Next PA', locale), disabled: cursor >= model.timeline.length, onClick: () => setCursor(value => Math.min(model.timeline.length, value + 1)), children: "\u203A" })] })] })] });
}
//# sourceMappingURL=ProjectGraphPage.js.map