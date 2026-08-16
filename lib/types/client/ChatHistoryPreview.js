import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { localized, useLocale } from "./i18n.js";
function json(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
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
function Blocks({ blocks, sourceSessionId, loadImage, hideToolCalls = false, }) {
    return _jsx("div", { className: "dsh-git-preview-blocks", children: blocks.map((block, index) => {
            const key = `${block.type}:${index}`;
            switch (block.type) {
                case 'text':
                    return block.text === '' ? null : _jsx(MarkdownText, { text: block.text }, key);
                case 'reasoning':
                    return block.text === '' ? null : _jsxs("section", { className: "dsh-git-preview-reasoning", children: [_jsx("strong", { children: "Think" }), _jsx(MarkdownText, { text: block.text })] }, key);
                case 'image':
                    return _jsx(PreviewImage, { sourceSessionId: sourceSessionId, attachment: block.attachment, load: loadImage }, key);
                case 'tool-call':
                    return hideToolCalls ? null : _jsxs("section", { className: "dsh-git-preview-tool", children: [_jsxs("header", { children: [_jsx("span", { children: block.name }), _jsx("code", { children: block.callId })] }), _jsx("pre", { children: block.arguments })] }, key);
                case 'tool-result':
                    return _jsxs("section", { className: "dsh-git-preview-tool", children: [_jsxs("header", { children: [_jsx("span", { children: block.isError ? 'Tool error' : 'Tool result' }), _jsx("code", { children: block.callId })] }), _jsx(Blocks, { blocks: block.content, sourceSessionId: sourceSessionId, loadImage: loadImage })] }, key);
                case 'other':
                    return _jsx("pre", { className: "dsh-git-preview-other", children: json(block.value) }, key);
            }
        }) });
}
function Record({ record, sourceSessionId, loadImage, }) {
    const locale = useLocale();
    switch (record.kind) {
        case 'user':
            return _jsx("div", { className: "dsh-git-preview-record dsh-git-preview-user", role: "article", "aria-label": localized('用户消息', 'User message', locale), children: _jsx(Blocks, { blocks: record.content, sourceSessionId: sourceSessionId, loadImage: loadImage }) });
        case 'assistant':
            return _jsx("div", { className: "dsh-git-preview-record dsh-git-preview-assistant", role: "article", "aria-label": localized('Assistant 消息', 'Assistant message', locale), children: _jsx(Blocks, { blocks: record.blocks, sourceSessionId: sourceSessionId, loadImage: loadImage, hideToolCalls: true }) });
        case 'tool-call':
            return _jsxs("section", { className: "dsh-git-preview-record dsh-git-preview-tool", children: [_jsxs("header", { children: [_jsx("span", { children: record.name }), _jsx("code", { children: record.callId })] }), _jsx("pre", { children: record.arguments })] });
        case 'tool-result':
            return _jsxs("section", { className: "dsh-git-preview-record dsh-git-preview-tool", children: [_jsxs("header", { children: [_jsx("span", { children: record.isError ? 'Tool error' : 'Tool result' }), _jsx("code", { children: record.callId })] }), _jsx(Blocks, { blocks: record.content, sourceSessionId: sourceSessionId, loadImage: loadImage })] });
        case 'request':
            return _jsxs("details", { className: "dsh-git-preview-record dsh-git-preview-request", children: [_jsx("summary", { children: record.requestKind === 'header' ? 'Request' : 'Context' }), _jsx("pre", { children: json(record.data) })] });
        case 'turn-status':
            return _jsx("div", { className: "dsh-git-preview-record dsh-git-muted", children: record.status });
        case 'event':
            return _jsxs("details", { className: "dsh-git-preview-record dsh-git-preview-event", children: [_jsx("summary", { children: record.eventType }), _jsx("pre", { children: json(record.data) })] });
    }
}
/** Read-only, official-style projection of the exact turns a Merge will seed. */
export function ChatHistoryPreview({ response, orderedNodeIds, labels, candidateNodeId, loading, error, loadImage, }) {
    const locale = useLocale();
    if (loading && response === null) {
        return _jsx("div", { className: "dsh-git-chat-status", role: "status", children: localized('正在读取完整 Chat History…', 'Loading complete Chat History…', locale) });
    }
    if (error !== null && response === null) {
        return _jsx("div", { className: "dsh-git-chat-status dsh-git-error", role: "alert", children: error });
    }
    if (response === null || response.turns.length === 0) {
        return _jsx("div", { className: "dsh-git-chat-status", children: localized('选择 PA 后，这里会显示合并后的聊天记录。', 'Select PAs to preview the merged chat history.', locale) });
    }
    return _jsxs("div", { className: "dsh-git-chat-history", "aria-busy": loading || undefined, children: [response.turns.map((turn, index) => {
                const nodeId = orderedNodeIds[index];
                const candidate = nodeId !== undefined && nodeId === candidateNodeId;
                return _jsxs("section", { className: `dsh-git-preview-turn ${candidate ? 'dsh-git-preview-turn-candidate' : ''}`, "data-preview-state": candidate ? 'candidate' : 'selected', children: [_jsxs("header", { className: "dsh-git-preview-turn-head", children: [_jsx("strong", { children: nodeId === undefined ? `PA${turn.targetTurn}` : labels.get(nodeId) ?? `PA${turn.targetTurn}` }), _jsx("span", { children: candidate ? localized('虚线预览', 'dashed preview', locale) : localized('已加入', 'included', locale) })] }), turn.records.map(record => _jsx(Record, { record: record, sourceSessionId: turn.source.sourceSessionId, loadImage: loadImage }, `${record.kind}:${record.seq}`))] }, `${turn.source.sourceSessionId}:${turn.source.sourceTurn}:${turn.source.sourceBoundarySeq}`);
            }), loading ? _jsx("div", { className: "dsh-git-muted", role: "status", children: localized('正在更新预览…', 'Updating preview…', locale) }) : null, error === null ? null : _jsx("div", { className: "dsh-git-error", role: "alert", children: error })] });
}
//# sourceMappingURL=ChatHistoryPreview.js.map