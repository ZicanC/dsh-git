import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useState } from 'react';
import { localized, useLocale } from "./i18n.js";
/**
 * The 30px conversation trail beside Chat History.
 *
 * Every dash is the PA at the same index in the right-hand preview. In compact
 * mode a dash stretches into its PA/title row. When Chat History owns the full
 * workbench, the same entries become rows whose hover card summarizes the PA.
 */
function HistoryRailView({ entries, includedCount, previewCount, disabled = false, expanded = false, onSelect, onActiveChange, }) {
    const locale = useLocale();
    const [activeId, setActiveId] = useState(null);
    const [summaryTop, setSummaryTop] = useState(null);
    useEffect(() => {
        if (activeId === null || entries.some(entry => entry.nodeId === activeId))
            return;
        setActiveId(null);
        setSummaryTop(null);
        onActiveChange?.(null);
    }, [activeId, entries, onActiveChange]);
    if (entries.length === 0)
        return null;
    const included = localized('已加入', 'included', locale);
    const preview = localized('预览', 'preview', locale);
    const noPrompt = localized('（无文字问题）', '(No text prompt)', locale);
    const noSummary = localized('该 PA 没有可显示的回答摘要。', 'This PA has no answer summary to display.', locale);
    const counts = previewCount === 0
        ? `${includedCount} ${included}`
        : `${includedCount} ${included} · ${previewCount} ${preview}`;
    const activate = (entry) => {
        setActiveId(entry.nodeId);
        onActiveChange?.(entry.nodeId);
    };
    const clear = () => {
        setActiveId(null);
        setSummaryTop(null);
        onActiveChange?.(null);
    };
    const blur = (event) => {
        if (event.currentTarget.contains(event.relatedTarget))
            return;
        clear();
    };
    const activateExpanded = (entry, element) => {
        activate(entry);
        const rail = element.closest('.dsh-git-rail-expanded');
        if (rail === null)
            return;
        const rowRect = element.getBoundingClientRect();
        const railRect = rail.getBoundingClientRect();
        setSummaryTop(rowRect.top - railRect.top + rowRect.height / 2);
    };
    const activeEntry = activeId === null ? undefined : entries.find(entry => entry.nodeId === activeId);
    if (expanded)
        return _jsxs("nav", { className: "dsh-git-rail dsh-git-rail-expanded", "aria-label": `${localized('会话轨迹', 'Conversation trail', locale)} · ${counts}`, onPointerLeave: (event) => {
                if (!event.currentTarget.contains(document.activeElement))
                    clear();
            }, children: [_jsxs("div", { className: "dsh-git-rail-expanded-scroll", onScroll: clear, children: [_jsxs("header", { className: "dsh-git-rail-expanded-head", children: [_jsx("span", { children: localized('会话轨迹', 'Conversation trail', locale) }), _jsx("span", { children: counts })] }), _jsx("ol", { className: "dsh-git-rail-expanded-list", children: entries.map(entry => {
                                const title = entry.prompt || noPrompt;
                                const active = entry.nodeId === activeId;
                                return _jsx("li", { children: _jsxs("button", { className: "dsh-git-rail-expanded-row", type: "button", disabled: disabled, style: { '--dsh-git-rail-indent': String(entry.indent) }, "data-rail-state": entry.state, "data-active": active ? '' : undefined, "data-head": entry.head ? '' : undefined, "data-branched": entry.branched ? '' : undefined, "data-node-id": entry.nodeId, "aria-label": `${entry.label} · ${title}`, "aria-current": entry.head ? 'true' : undefined, "aria-controls": `dsh-git-history-${entry.nodeId}`, "aria-describedby": active ? `dsh-git-rail-summary-${entry.nodeId}` : undefined, onPointerEnter: event => activateExpanded(entry, event.currentTarget), onFocus: event => activateExpanded(entry, event.currentTarget), onBlur: blur, onClick: () => onSelect(entry.nodeId), children: [entry.branched ? _jsx("span", { className: "dsh-git-rail-expanded-elbow", "aria-hidden": "true" }) : null, _jsx("span", { className: "dsh-git-rail-expanded-label", children: entry.label }), entry.head ? _jsx("span", { className: "dsh-git-rail-expanded-head-tag", children: "HEAD" }) : null, _jsx("span", { className: "dsh-git-rail-expanded-dot", "aria-hidden": "true" }), _jsx("span", { className: "dsh-git-rail-expanded-prompt", children: title }), entry.state === 'preview'
                                                ? _jsx("span", { className: "dsh-git-rail-expanded-preview", children: preview })
                                                : null] }) }, entry.nodeId);
                            }) })] }), activeEntry === undefined || summaryTop === null ? null : _jsxs("aside", { className: "dsh-git-rail-summary", id: `dsh-git-rail-summary-${activeEntry.nodeId}`, role: "tooltip", "data-rail-state": activeEntry.state, style: { '--dsh-git-rail-summary-top': `${summaryTop}px` }, children: [_jsxs("strong", { children: [_jsx("span", { children: activeEntry.label }), _jsx("span", { className: "dsh-git-rail-summary-dot", "aria-hidden": "true" }), _jsx("span", { children: activeEntry.summaryTitle || activeEntry.prompt || noPrompt })] }), _jsx("span", { children: activeEntry.summary || noSummary })] })] });
    return _jsx("nav", { className: "dsh-git-rail", "data-active": activeId === null ? undefined : '', "aria-label": `${localized('会话轨迹', 'Conversation trail', locale)} · ${counts}`, onPointerLeave: (event) => {
            if (!event.currentTarget.contains(document.activeElement))
                clear();
        }, children: _jsx("div", { className: "dsh-git-rail-scroll", children: _jsx("ol", { className: "dsh-git-rail-list", children: entries.map(entry => {
                    const title = entry.prompt || noPrompt;
                    const active = entry.nodeId === activeId;
                    return _jsx("li", { className: "dsh-git-rail-item", style: { '--dsh-git-rail-indent': String(entry.indent) }, children: _jsxs("button", { className: "dsh-git-rail-dash", type: "button", disabled: disabled, style: { '--dsh-git-rail-dash-width': `${entry.width}px` }, "data-rail-state": entry.state, "data-active": active ? '' : undefined, "data-head": entry.head ? '' : undefined, "data-branched": entry.branched ? '' : undefined, "data-node-id": entry.nodeId, "aria-label": `${entry.label} · ${title}`, "aria-current": entry.head ? 'true' : undefined, "aria-controls": `dsh-git-history-${entry.nodeId}`, onPointerEnter: () => activate(entry), onFocus: () => activate(entry), onBlur: blur, onClick: () => onSelect(entry.nodeId), children: [_jsx("span", { className: "dsh-git-rail-stroke", "aria-hidden": "true" }), _jsxs("span", { className: "dsh-git-rail-copy", children: [_jsx("span", { className: "dsh-git-rail-state-line", "aria-hidden": "true" }), entry.branched ? _jsx("span", { className: "dsh-git-rail-elbow", "aria-hidden": "true" }) : null, _jsx("span", { className: "dsh-git-rail-label", children: entry.label }), entry.head ? _jsx("span", { className: "dsh-git-rail-head", children: "HEAD" }) : null, _jsx("span", { className: "dsh-git-rail-dot", "aria-hidden": "true" }), _jsx("span", { className: "dsh-git-rail-prompt", children: title }), entry.state === 'preview' ? _jsx("span", { className: "dsh-git-rail-tag", children: preview }) : null] })] }) }, entry.nodeId);
                }) }) }) });
}
/** Memoized: the trail only changes with the selection, never with a delta. */
export const HistoryRail = memo(HistoryRailView);
//# sourceMappingURL=HistoryRail.js.map