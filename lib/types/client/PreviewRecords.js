import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Row components of the Chat History preview: one per kind of projected log record. */
import { useEffect, useState } from 'react';
import { DisclosureRow, IconApiOutlineRegular, IconBrowseOutlineRegular, IconThinkOutlineRegular, JsonBlock, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import { localized } from "./i18n.js";
import { PreviewMarkdown } from "./PreviewMarkdown.js";
import { argumentSummary, firstBlockText, formattedArguments, json, oneLine, previewContextProvenance, sourceKind, } from "./preview-text.js";
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
/** Thin divider between the parts of a one-line row. */
export function separator() {
    return _jsx("span", { className: "dsh-git-preview-disclosure-separator", "aria-hidden": true });
}
function ReasoningRow({ text }) {
    const [open, setOpen] = useState(false);
    return _jsx(DisclosureRow, { className: "dsh-git-preview-disclosure", icon: _jsx(IconThinkOutlineRegular, { size: 14 }), title: "Think", open: open, expandable: true, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: () => { setOpen(value => !value); }, collapsedContent: _jsxs(_Fragment, { children: [separator(), _jsx("span", { className: "dsh-git-preview-disclosure-summary", children: oneLine(text) })] }), children: _jsx("div", { className: "dsh-git-preview-reasoning-body", children: text }) });
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
                        : _jsx(PreviewMarkdown, { text: block.text }, key);
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
    return _jsx("div", { className: "dsh-git-preview-user", role: "article", "aria-label": localized('用户消息', 'User message', locale), children: _jsxs("div", { className: "dsh-git-preview-user-stack", children: [images.length === 0 ? null : _jsx("div", { className: "dsh-git-preview-user-images", children: images.map((block, index) => _jsx(PreviewImage, { sourceSessionId: sourceSessionId, attachment: block.attachment, load: loadImage }, `${block.attachment.attachmentId}:${index}`)) }), text === '' && rest.length === 0 ? null : _jsxs("div", { className: "dsh-git-preview-user-bubble", children: [text === '' ? null : _jsx("div", { className: "dsh-git-preview-user-text", children: text }), rest.map((block, index) => block.type === 'other'
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
    return _jsx(DisclosureRow, { className: "dsh-git-preview-disclosure dsh-git-preview-context", icon: _jsx(IconBrowseOutlineRegular, { size: 14 }), title: title, open: open, expandable: true, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: () => { setOpen(value => !value); }, collapsedContent: _jsxs(_Fragment, { children: [provenance.label === null ? null : _jsxs(_Fragment, { children: [separator(), _jsx("span", { className: "dsh-git-preview-disclosure-source", children: provenance.label })] }), summary === '' ? null : _jsxs(_Fragment, { children: [separator(), _jsx("span", { className: "dsh-git-preview-disclosure-summary", children: summary })] })] }), children: _jsx("div", { className: "dsh-git-preview-context-body", children: _jsx(Blocks, { blocks: record.content, sourceSessionId: sourceSessionId, loadImage: loadImage, mode: "tool" }) }) });
}
function ToolRow({ call, result, sourceSessionId, loadImage, locale, }) {
    const [open, setOpen] = useState(false);
    const failed = result?.isError === true;
    const title = call?.name ?? localized('工具', 'Tool', locale);
    const summary = failed
        ? firstBlockText(result?.content ?? []) || localized('工具运行失败', 'Tool failed', locale)
        : argumentSummary(call?.arguments ?? '') || firstBlockText(result?.content ?? []) || localized('已完成', 'Done', locale);
    const expandable = call !== undefined || result !== undefined;
    return _jsx(DisclosureRow, { className: "dsh-git-preview-disclosure dsh-git-preview-tool-row", icon: failed ? _jsx(StateDot, { state: "error" }) : _jsx(IconApiOutlineRegular, { size: 14 }), title: title, open: open, expandable: expandable, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: () => { setOpen(value => !value); }, collapsedContent: _jsxs(_Fragment, { children: [separator(), _jsx("span", { className: "dsh-git-preview-disclosure-summary", "data-error": failed || undefined, children: summary })] }), children: _jsxs("div", { className: "dsh-git-preview-tool-body", "data-error": failed || undefined, children: [call === undefined ? null : _jsxs("section", { className: "dsh-git-preview-tool-part", children: [_jsx("span", { className: "dsh-git-preview-tool-label", children: "IN" }), _jsx("pre", { children: formattedArguments(call.arguments) })] }), result === undefined ? null : _jsxs("section", { className: "dsh-git-preview-tool-part", children: [_jsx("span", { className: "dsh-git-preview-tool-label", children: "OUT" }), _jsxs("div", { children: [_jsx(Blocks, { blocks: result.content, sourceSessionId: sourceSessionId, loadImage: loadImage, mode: "tool" }), result.error === undefined ? null : _jsxs("code", { className: "dsh-git-preview-tool-error", children: [result.error.name, " \u00B7 ", result.error.code] })] })] })] }) });
}
function StatusRecord({ record, locale }) {
    const warning = record.status === 'max-tokens';
    return _jsxs("div", { className: "dsh-git-preview-status", role: "status", children: [_jsx(StateDot, { state: warning ? 'warning' : 'error' }), _jsx("strong", { children: warning
                    ? localized('达到最大 token 数', 'Maximum tokens reached', locale)
                    : localized('本轮未正常完成', 'Turn did not complete', locale) }), _jsx("span", { children: record.status })] });
}
function EventRecord({ record }) {
    const [open, setOpen] = useState(false);
    return _jsx(DisclosureRow, { className: "dsh-git-preview-disclosure dsh-git-preview-event", icon: _jsx(IconApiOutlineRegular, { size: 14 }), title: record.eventType, open: open, expandable: true, expandOnRowClick: true, onToggle: () => { setOpen(value => !value); }, children: _jsx("div", { className: "dsh-git-preview-context-body", children: _jsx("pre", { children: json(record.data) }) }) });
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
/** Every record of one turn in log order, with each tool call paired to its result. */
export function TurnRecords({ records, sourceSessionId, loadImage, locale, }) {
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
//# sourceMappingURL=PreviewRecords.js.map