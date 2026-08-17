import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, } from 'react';
import { DisclosureRow, IconApiOutline14, IconBrowseOutline16, IconChevronDownOutline14, IconThinkOutline14, JsonBlock, MarkdownText, MessageText, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import { localized, useLocale } from "./i18n.js";
function json(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
function oneLine(value, maximum = 180) {
    const line = value.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
    return line.length <= maximum ? line : `${line.slice(0, maximum - 1)}…`;
}
function sourceKind(source) {
    if (typeof source !== 'object' || source === null || Array.isArray(source))
        return null;
    const record = source;
    return typeof record.kind === 'string' ? record.kind : null;
}
function sourceRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    return value;
}
function sourceString(record, key) {
    const value = record[key];
    return typeof value === 'string' && value !== '' ? value : null;
}
/** Same durable-source projection used by the official Context Injection row. */
function previewContextProvenance(source) {
    const record = sourceRecord(source);
    if (record === null)
        return { role: 'inject', label: null };
    const kind = sourceString(record, 'kind');
    if (kind === null)
        return { role: 'inject', label: null };
    const collect = (member, field) => {
        const entries = record[member];
        if (!Array.isArray(entries))
            return [];
        const values = [];
        for (const entry of entries) {
            const item = sourceRecord(entry);
            const value = item === null ? null : sourceString(item, field);
            if (value !== null && !values.includes(value))
                values.push(value);
        }
        return values;
    };
    if (kind === 'session-reference') {
        const labels = collect('references', 'label');
        return { role: 'recall', label: labels.length === 0 ? kind : labels.join(', ') };
    }
    if (kind === 'agent-instructions') {
        const paths = collect('changes', 'path');
        return { role: 'inject', label: paths.length === 0 ? kind : paths.join(', ') };
    }
    if (kind === 'plugin')
        return { role: 'inject', label: sourceString(record, 'plugin') ?? kind };
    if (kind === 'skill-invocation')
        return { role: 'inject', label: sourceString(record, 'name') ?? kind };
    return { role: 'inject', label: kind };
}
function firstBlockText(blocks) {
    for (const block of blocks) {
        if ((block.type === 'text' || block.type === 'reasoning') && block.text.trim() !== '')
            return oneLine(block.text);
        if (block.type === 'tool-result') {
            const nested = firstBlockText(block.content);
            if (nested !== '')
                return nested;
        }
    }
    return '';
}
function argumentSummary(argumentsText) {
    try {
        const parsed = JSON.parse(argumentsText);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return oneLine(String(parsed));
        const record = parsed;
        for (const key of ['description', 'path', 'file_path', 'command', 'query', 'pattern', 'url', 'name']) {
            const value = record[key];
            if (typeof value === 'string' && value.trim() !== '')
                return oneLine(value);
        }
    }
    catch {
        // Tool arguments are producer-owned; malformed JSON stays readable as text.
    }
    return oneLine(argumentsText);
}
function formattedArguments(argumentsText) {
    try {
        return JSON.stringify(JSON.parse(argumentsText), null, 2);
    }
    catch {
        return argumentsText;
    }
}
function PreviewImage({ sourceSessionId, attachment, load, }) {
    const [loaded, setLoaded] = useState(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        let resource = null;
        setLoaded(null);
        setFailed(false);
        void load(sourceSessionId, attachment).then((next) => {
            resource = next;
            if (active)
                setLoaded(next);
            else
                next.release();
        }).catch(() => { if (active)
            setFailed(true); });
        return () => {
            active = false;
            resource?.release();
        };
    }, [sourceSessionId, attachment.attachmentId, load]);
    if (failed)
        return _jsx("span", { className: "dsh-git-muted", children: attachment.name ?? attachment.attachmentId });
    if (loaded === null)
        return _jsxs("span", { className: "dsh-git-muted", children: [attachment.name ?? 'Image', "\u2026"] });
    return _jsx("img", { className: "dsh-git-preview-image", src: loaded.url, alt: attachment.name ?? 'Chat attachment' });
}
function separator() {
    return _jsx("span", { className: "dsh-git-preview-disclosure-separator", "aria-hidden": true });
}
function ReasoningRow({ text }) {
    const [open, setOpen] = useState(false);
    return _jsx(DisclosureRow, { className: "dsh-git-preview-disclosure", icon: _jsx(IconThinkOutline14, { size: 14 }), title: "Think", open: open, expandable: true, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: () => { setOpen(value => !value); }, collapsedContent: _jsxs(_Fragment, { children: [separator(), _jsx("span", { className: "dsh-git-preview-disclosure-summary", children: oneLine(text) })] }), children: _jsx("div", { className: "dsh-git-preview-reasoning-body", children: text }) });
}
function Blocks({ blocks, sourceSessionId, loadImage, mode = 'assistant', hideToolCalls = false, }) {
    return _jsx("div", { className: `dsh-git-preview-blocks dsh-git-preview-blocks-${mode}`, children: blocks.map((block, index) => {
            const key = `${block.type}:${index}`;
            switch (block.type) {
                case 'text':
                    if (block.text === '')
                        return null;
                    return mode === 'tool'
                        ? _jsx("pre", { className: "dsh-git-preview-tool-output", children: block.text }, key)
                        : _jsx(MarkdownText, { text: block.text }, key);
                case 'reasoning':
                    return block.text === '' ? null : _jsx(ReasoningRow, { text: block.text }, key);
                case 'image':
                    return _jsx(PreviewImage, { sourceSessionId: sourceSessionId, attachment: block.attachment, load: loadImage }, key);
                case 'tool-call':
                    return hideToolCalls ? null : _jsx("pre", { className: "dsh-git-preview-tool-output", children: block.arguments }, key);
                case 'tool-result':
                    return _jsx(Blocks, { blocks: block.content, sourceSessionId: sourceSessionId, loadImage: loadImage, mode: "tool" }, key);
                case 'other':
                    return _jsx(JsonBlock, { label: block.originalType, payload: block.value, truncatedLabel: total => `… ${total}` }, key);
            }
        }) });
}
function UserMessage({ record, sourceSessionId, loadImage, locale, }) {
    const text = record.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    const images = record.content.filter((block) => block.type === 'image');
    const rest = record.content.filter(block => block.type !== 'text' && block.type !== 'image');
    return _jsx("div", { className: "dsh-git-preview-user", role: "article", "aria-label": localized('用户消息', 'User message', locale), children: _jsxs("div", { className: "dsh-git-preview-user-stack", children: [images.length === 0 ? null : _jsx("div", { className: "dsh-git-preview-user-images", children: images.map((block, index) => _jsx(PreviewImage, { sourceSessionId: sourceSessionId, attachment: block.attachment, load: loadImage }, `${block.attachment.attachmentId}:${index}`)) }), text === '' && rest.length === 0 ? null : _jsxs("div", { className: "dsh-git-preview-user-bubble", children: [text === '' ? null : _jsx(MessageText, { text: text }), rest.map((block, index) => block.type === 'other'
                            ? _jsx(JsonBlock, { label: block.originalType, payload: block.value, truncatedLabel: total => `… ${total}` }, index)
                            : _jsx("pre", { className: "dsh-git-preview-other", children: json(block) }, index))] })] }) });
}
function ContextMessage({ record, sourceSessionId, loadImage, locale, }) {
    const [open, setOpen] = useState(false);
    const provenance = previewContextProvenance(record.source);
    const summary = firstBlockText(record.content);
    const title = provenance.role === 'recall'
        ? localized('上下文回溯', 'Context recall', locale)
        : localized('上下文注入', 'Context injection', locale);
    return _jsx(DisclosureRow, { className: "dsh-git-preview-disclosure dsh-git-preview-context", icon: _jsx(IconBrowseOutline16, { size: 14 }), title: title, open: open, expandable: true, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: () => { setOpen(value => !value); }, collapsedContent: _jsxs(_Fragment, { children: [provenance.label === null ? null : _jsxs(_Fragment, { children: [separator(), _jsx("span", { className: "dsh-git-preview-disclosure-source", children: provenance.label })] }), summary === '' ? null : _jsxs(_Fragment, { children: [separator(), _jsx("span", { className: "dsh-git-preview-disclosure-summary", children: summary })] })] }), children: _jsx("div", { className: "dsh-git-preview-context-body", children: _jsx(Blocks, { blocks: record.content, sourceSessionId: sourceSessionId, loadImage: loadImage, mode: "tool" }) }) });
}
function ToolRow({ call, result, sourceSessionId, loadImage, locale, }) {
    const [open, setOpen] = useState(false);
    const failed = result?.isError === true;
    const title = call?.name ?? localized('工具', 'Tool', locale);
    const summary = failed
        ? firstBlockText(result?.content ?? []) || localized('工具运行失败', 'Tool failed', locale)
        : argumentSummary(call?.arguments ?? '') || firstBlockText(result?.content ?? []) || localized('已完成', 'Done', locale);
    const expandable = call !== undefined || result !== undefined;
    return _jsx(DisclosureRow, { className: "dsh-git-preview-disclosure dsh-git-preview-tool-row", icon: failed ? _jsx(StateDot, { state: "error" }) : _jsx(IconApiOutline14, { size: 14 }), title: title, open: open, expandable: expandable, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: () => { setOpen(value => !value); }, collapsedContent: _jsxs(_Fragment, { children: [separator(), _jsx("span", { className: "dsh-git-preview-disclosure-summary", "data-error": failed || undefined, children: summary })] }), children: _jsxs("div", { className: "dsh-git-preview-tool-body", "data-error": failed || undefined, children: [call === undefined ? null : _jsxs("section", { className: "dsh-git-preview-tool-part", children: [_jsx("span", { className: "dsh-git-preview-tool-label", children: "IN" }), _jsx("pre", { children: formattedArguments(call.arguments) })] }), result === undefined ? null : _jsxs("section", { className: "dsh-git-preview-tool-part", children: [_jsx("span", { className: "dsh-git-preview-tool-label", children: "OUT" }), _jsxs("div", { children: [_jsx(Blocks, { blocks: result.content, sourceSessionId: sourceSessionId, loadImage: loadImage, mode: "tool" }), result.error === undefined ? null : _jsxs("code", { className: "dsh-git-preview-tool-error", children: [result.error.name, " \u00B7 ", result.error.code] })] })] })] }) });
}
function StatusRecord({ record, locale }) {
    const warning = record.status === 'max-tokens';
    return _jsxs("div", { className: "dsh-git-preview-status", role: "status", children: [_jsx(StateDot, { state: warning ? 'warning' : 'error' }), _jsx("strong", { children: warning
                    ? localized('达到最大 token 数', 'Maximum tokens reached', locale)
                    : localized('本轮未正常完成', 'Turn did not complete', locale) }), _jsx("span", { children: record.status })] });
}
function EventRecord({ record }) {
    const [open, setOpen] = useState(false);
    return _jsx(DisclosureRow, { className: "dsh-git-preview-disclosure dsh-git-preview-event", icon: _jsx(IconApiOutline14, { size: 14 }), title: record.eventType, open: open, expandable: true, expandOnRowClick: true, onToggle: () => { setOpen(value => !value); }, children: _jsx("div", { className: "dsh-git-preview-context-body", children: _jsx("pre", { children: json(record.data) }) }) });
}
function Record({ record, sourceSessionId, loadImage, locale, }) {
    switch (record.kind) {
        case 'user':
            return sourceKind(record.source) === 'user'
                ? _jsx(UserMessage, { record: record, sourceSessionId: sourceSessionId, loadImage: loadImage, locale: locale })
                : _jsx(ContextMessage, { record: record, sourceSessionId: sourceSessionId, loadImage: loadImage, locale: locale });
        case 'assistant':
            return _jsx("div", { className: "dsh-git-preview-assistant", role: "article", "aria-label": localized('Assistant 消息', 'Assistant message', locale), children: _jsx(Blocks, { blocks: record.blocks, sourceSessionId: sourceSessionId, loadImage: loadImage, hideToolCalls: true }) });
        case 'tool-call':
            return _jsx(ToolRow, { call: record, sourceSessionId: sourceSessionId, loadImage: loadImage, locale: locale });
        case 'tool-result':
            return _jsx(ToolRow, { result: record, sourceSessionId: sourceSessionId, loadImage: loadImage, locale: locale });
        case 'turn-status':
            return _jsx(StatusRecord, { record: record, locale: locale });
        case 'event':
            return _jsx(EventRecord, { record: record });
        // request/header and request/context are model-call metadata. The official
        // Chat surface does not render them as conversation messages.
        case 'request':
            return null;
    }
}
function TurnRecords({ records, sourceSessionId, loadImage, locale, }) {
    const calls = new Map();
    const results = new Map();
    for (const record of records) {
        if (record.kind === 'tool-call')
            calls.set(record.callId, record);
        if (record.kind === 'tool-result')
            results.set(record.callId, record);
    }
    return _jsx("div", { className: "dsh-git-preview-flow", children: records.map(record => {
            if (record.kind === 'request')
                return null;
            if (record.kind === 'tool-call') {
                const result = results.get(record.callId);
                // Keyed by call identity alone: a streaming call keeps its row — and its
                // open/closed disclosure state — when its result finally lands.
                return _jsx(ToolRow, { call: record, ...result === undefined ? {} : { result }, sourceSessionId: sourceSessionId, loadImage: loadImage, locale: locale }, `tool:${record.callId}`);
            }
            if (record.kind === 'tool-result' && calls.has(record.callId))
                return null;
            return _jsx(Record, { record: record, sourceSessionId: sourceSessionId, loadImage: loadImage, locale: locale }, `${record.kind}:${record.seq}`);
        }) });
}
/**
 * One rendered turn.
 *
 * Memoized on its own record list: the Host projection of a settled PA is
 * frozen and cached, so a streaming tail, a selection edit elsewhere, or a
 * rail hover re-renders only the section that actually changed — the same
 * per-row economics the official chat gets from its keyed node seats.
 */
const TurnSection = memo(function TurnSection({ records, sourceSessionId, loadImage, locale, nodeId, label, stateLabel, state, railActive, pending, }) {
    return _jsxs("section", { className: "dsh-git-preview-turn", id: nodeId === undefined ? undefined : `dsh-git-history-${nodeId}`, "data-node-id": nodeId, "data-preview-state": state, tabIndex: -1, "aria-label": `${label} · ${stateLabel}`, "aria-busy": pending || undefined, "data-rail-active": railActive ? '' : undefined, children: [_jsxs("header", { className: "dsh-git-preview-turn-head", children: [_jsx("strong", { children: label }), separator(), _jsx("span", { children: stateLabel })] }), pending && records.length === 0
                ? _jsx("div", { className: "dsh-git-muted", role: "status", children: localized('正在读取该 PA…', 'Loading this PA…', locale) })
                : _jsx(TurnRecords, { records: records, sourceSessionId: sourceSessionId, loadImage: loadImage, locale: locale })] });
});
/** Read-only, official-style projection of the exact turns a Merge will seed. */
export function ChatHistoryPreview({ response, orderedNodeIds, labels, candidateNodeId, activeNodeId = null, pendingNodeIds, liveTurns, loading, error, loadImage, }) {
    const locale = useLocale();
    const scrollRef = useRef(null);
    const columnRef = useRef(null);
    const observerRef = useRef(null);
    const atBottomRef = useRef(true);
    const [atBottom, setAtBottom] = useState(true);
    // Keeps the memoized sections memoized: the injected loader is rebuilt by
    // the plugin face, this identity never is.
    const loadImageRef = useRef(loadImage);
    loadImageRef.current = loadImage;
    const stableLoadImage = useCallback((sourceSessionId, attachment) => loadImageRef.current(sourceSessionId, attachment), []);
    const scrollToBottom = useCallback(() => {
        const element = scrollRef.current;
        if (element === null)
            return;
        element.scrollTop = element.scrollHeight;
        atBottomRef.current = true;
        setAtBottom(true);
    }, []);
    // Streaming grows the flow token by token, well below the render cadence a
    // prop-keyed effect can see. Follow the measured column instead, and only
    // while the reader is still pinned to the floor.
    //
    // Attached from the ref callbacks, not from a mount effect: the panel starts
    // on the loading or empty-selection status view, so the scroller and column
    // only enter the tree once there is something to render — an effect that ran
    // once at mount would observe nothing and never re-run.
    const observe = useCallback(() => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        const column = columnRef.current;
        const element = scrollRef.current;
        if (column === null || element === null || typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(() => {
            if (atBottomRef.current)
                element.scrollTop = element.scrollHeight;
        });
        observer.observe(column);
        observer.observe(element);
        observerRef.current = observer;
    }, []);
    const attachScroller = useCallback((node) => {
        scrollRef.current = node;
        observe();
    }, [observe]);
    const attachColumn = useCallback((node) => {
        columnRef.current = node;
        observe();
    }, [observe]);
    useEffect(() => () => {
        observerRef.current?.disconnect();
        observerRef.current = null;
    }, []);
    const live = liveTurns ?? [];
    // A live turn the official Chat just opened is content the reader submitted
    // themselves: land on it, even if they had scrolled up to read history. Keyed
    // on the tail turn alone, so the rest of its stream never yanks the viewport
    // back once they scroll away.
    const liveTailKey = live.length === 0 ? null : live[live.length - 1]?.key ?? null;
    useLayoutEffect(() => {
        if (liveTailKey !== null)
            scrollToBottom();
    }, [liveTailKey, scrollToBottom]);
    useLayoutEffect(() => {
        if (response !== null && atBottomRef.current)
            scrollToBottom();
    }, [response, scrollToBottom]);
    if (loading && response === null && live.length === 0) {
        return _jsx("div", { className: "dsh-git-chat-status", role: "status", children: localized('正在读取完整 Chat History…', 'Loading complete Chat History…', locale) });
    }
    if (error !== null && response === null && live.length === 0) {
        return _jsx("div", { className: "dsh-git-chat-status dsh-git-error", role: "alert", children: error });
    }
    if ((response === null || response.turns.length === 0) && live.length === 0) {
        return _jsx("div", { className: "dsh-git-chat-status", children: localized('选择 PA 后，这里会显示合并后的聊天记录。', 'Select PAs to preview the merged chat history.', locale) });
    }
    return _jsxs("div", { className: "dsh-git-chat-history", "aria-busy": loading || undefined, ref: attachScroller, onScroll: (event) => {
            const element = event.currentTarget;
            const next = element.scrollHeight - element.scrollTop - element.clientHeight <= 25;
            atBottomRef.current = next;
            setAtBottom(next);
        }, children: [_jsxs("div", { className: "dsh-git-preview-column", ref: attachColumn, children: [(response?.turns ?? []).map((turn, index) => {
                        const nodeId = orderedNodeIds[index];
                        const candidate = nodeId !== undefined && nodeId === candidateNodeId;
                        const label = nodeId === undefined ? `PA${turn.targetTurn}` : labels.get(nodeId) ?? `PA${turn.targetTurn}`;
                        const pending = nodeId !== undefined && pendingNodeIds?.has(nodeId) === true;
                        const stateLabel = candidate
                            ? localized('虚线预览', 'dashed preview', locale)
                            : localized('已加入', 'included', locale);
                        return _jsx(TurnSection, { records: turn.records, sourceSessionId: turn.source.sourceSessionId, loadImage: stableLoadImage, locale: locale, ...nodeId === undefined ? {} : { nodeId }, label: label, stateLabel: stateLabel, state: candidate ? 'candidate' : 'selected', railActive: nodeId !== undefined && nodeId === activeNodeId, pending: pending }, `${turn.source.sourceSessionId}:${turn.source.sourceTurn}:${turn.source.sourceBoundarySeq}`);
                    }), live.map(turn => _jsx(TurnSection, { records: turn.records, sourceSessionId: turn.sourceSessionId, loadImage: stableLoadImage, locale: locale, label: turn.label, stateLabel: localized('生成中', 'streaming', locale), state: "live", railActive: false, pending: false }, turn.key)), loading ? _jsx("div", { className: "dsh-git-muted", role: "status", children: localized('正在更新预览…', 'Updating preview…', locale) }) : null, error === null ? null : _jsx("div", { className: "dsh-git-error", role: "alert", children: error })] }), atBottom ? null : _jsx("div", { className: "dsh-git-preview-to-bottom-slot", children: _jsx("button", { type: "button", className: "dsh-git-preview-to-bottom", "aria-label": localized('回到底部', 'Back to bottom', locale), onClick: scrollToBottom, children: _jsx(IconChevronDownOutline14, { size: 14 }) }) })] });
}
//# sourceMappingURL=ChatHistoryPreview.js.map