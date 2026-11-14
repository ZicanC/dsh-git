import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useCallback, useLayoutEffect, useRef, } from 'react';
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { localized, useLocale } from "./i18n.js";
import { TurnRecords, separator } from "./PreviewRecords.js";
import { useStickToBottom } from "./stick-to-bottom.js";
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
    // Keeps the memoized sections memoized: the injected loader is rebuilt by
    // the plugin face, this identity never is.
    const loadImageRef = useRef(loadImage);
    loadImageRef.current = loadImage;
    const stableLoadImage = useCallback((sourceSessionId, attachment) => loadImageRef.current(sourceSessionId, attachment), []);
    const { attachScroller, attachColumn, atBottom, pinned, scrollToBottom, onScroll } = useStickToBottom();
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
        if (response !== null && pinned())
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
    return _jsxs("div", { className: "dsh-git-chat-history", "aria-busy": loading || undefined, ref: attachScroller, onScroll: onScroll, children: [_jsxs("div", { className: "dsh-git-preview-column", ref: attachColumn, children: [(response?.turns ?? []).map((turn, index) => {
                        const nodeId = orderedNodeIds[index];
                        const candidate = nodeId !== undefined && nodeId === candidateNodeId;
                        const label = nodeId === undefined ? `PA${turn.targetTurn}` : labels.get(nodeId) ?? `PA${turn.targetTurn}`;
                        const pending = nodeId !== undefined && pendingNodeIds?.has(nodeId) === true;
                        const stateLabel = candidate
                            ? localized('虚线预览', 'dashed preview', locale)
                            : localized('已加入', 'included', locale);
                        return _jsx(TurnSection, { records: turn.records, sourceSessionId: turn.source.sourceSessionId, loadImage: stableLoadImage, locale: locale, ...nodeId === undefined ? {} : { nodeId }, label: label, stateLabel: stateLabel, state: candidate ? 'candidate' : 'selected', railActive: nodeId !== undefined && nodeId === activeNodeId, pending: pending }, `${turn.source.sourceSessionId}:${turn.source.sourceTurn}:${turn.source.sourceBoundarySeq}`);
                    }), live.map(turn => _jsx(TurnSection, { records: turn.records, sourceSessionId: turn.sourceSessionId, loadImage: stableLoadImage, locale: locale, label: turn.label, stateLabel: localized('生成中', 'streaming', locale), state: "live", railActive: false, pending: false }, turn.key)), loading ? _jsx("div", { className: "dsh-git-muted", role: "status", children: localized('正在更新预览…', 'Updating preview…', locale) }) : null, error === null ? null : _jsx("div", { className: "dsh-git-error", role: "alert", children: error })] }), atBottom ? null : _jsx("div", { className: "dsh-git-preview-to-bottom-slot", children: _jsx("button", { type: "button", className: "dsh-git-preview-to-bottom", "aria-label": localized('回到底部', 'Back to bottom', locale), onClick: scrollToBottom, children: _jsx(IconChevronDownOutlineRegular, { size: 14 }) }) })] });
}
//# sourceMappingURL=ChatHistoryPreview.js.map