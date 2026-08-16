import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { localized, useLocale } from "./i18n.js";
/**
 * The 30px conversation trail beside Chat History.
 *
 * Every dash is the PA at the same index in the right-hand preview. Hovering a
 * dash stretches that dash into its PA/title row; it never substitutes an
 * answer card or a second, independently ordered list.
 */
export function HistoryRail({ entries, includedCount, previewCount, disabled = false, onSelect, onActiveChange, }) {
    const locale = useLocale();
    const [activeId, setActiveId] = useState(null);
    useEffect(() => {
        if (activeId === null || entries.some(entry => entry.nodeId === activeId))
            return;
        setActiveId(null);
        onActiveChange?.(null);
    }, [activeId, entries, onActiveChange]);
    if (entries.length === 0)
        return null;
    const included = localized('已加入', 'included', locale);
    const preview = localized('预览', 'preview', locale);
    const noPrompt = localized('（无文字问题）', '(No text prompt)', locale);
    const counts = previewCount === 0
        ? `${includedCount} ${included}`
        : `${includedCount} ${included} · ${previewCount} ${preview}`;
    const activate = (entry) => {
        setActiveId(entry.nodeId);
        onActiveChange?.(entry.nodeId);
    };
    const clear = () => {
        setActiveId(null);
        onActiveChange?.(null);
    };
    const blur = (event) => {
        if (event.currentTarget.contains(event.relatedTarget))
            return;
        clear();
    };
    return _jsx("nav", { className: "dsh-git-rail", "data-active": activeId === null ? undefined : '', "aria-label": `${localized('会话轨迹', 'Conversation trail', locale)} · ${counts}`, onPointerLeave: (event) => {
            if (!event.currentTarget.contains(document.activeElement))
                clear();
        }, children: _jsx("div", { className: "dsh-git-rail-scroll", children: _jsx("ol", { className: "dsh-git-rail-list", children: entries.map(entry => {
                    const title = entry.prompt || noPrompt;
                    const active = entry.nodeId === activeId;
                    return _jsx("li", { className: "dsh-git-rail-item", style: { '--dsh-git-rail-indent': String(entry.indent) }, children: _jsxs("button", { className: "dsh-git-rail-dash", type: "button", disabled: disabled, style: { '--dsh-git-rail-dash-width': `${entry.width}px` }, "data-rail-state": entry.state, "data-active": active ? '' : undefined, "data-head": entry.head ? '' : undefined, "data-branched": entry.branched ? '' : undefined, "data-node-id": entry.nodeId, "aria-label": `${entry.label} · ${title}`, "aria-current": entry.head ? 'true' : undefined, "aria-controls": `dsh-git-history-${entry.nodeId}`, onPointerEnter: () => activate(entry), onFocus: () => activate(entry), onBlur: blur, onClick: () => onSelect(entry.nodeId), children: [_jsx("span", { className: "dsh-git-rail-stroke", "aria-hidden": "true" }), _jsxs("span", { className: "dsh-git-rail-copy", children: [_jsx("span", { className: "dsh-git-rail-state-line", "aria-hidden": "true" }), entry.branched ? _jsx("span", { className: "dsh-git-rail-elbow", "aria-hidden": "true" }) : null, _jsx("span", { className: "dsh-git-rail-label", children: entry.label }), entry.head ? _jsx("span", { className: "dsh-git-rail-head", children: "HEAD" }) : null, _jsx("span", { className: "dsh-git-rail-dot", "aria-hidden": "true" }), _jsx("span", { className: "dsh-git-rail-prompt", children: title }), entry.state === 'preview' ? _jsx("span", { className: "dsh-git-rail-tag", children: preview }) : null] })] }) }, entry.nodeId);
                }) }) }) });
}
//# sourceMappingURL=HistoryRail.js.map