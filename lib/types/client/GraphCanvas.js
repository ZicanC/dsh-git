import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useMemo, } from 'react';
import { orderedNodes, paIdentityId } from "./graph.js";
import { nodeLabelMap } from "./labels.js";
import { localized, useLocale } from "./i18n.js";
import { usePanZoom } from "./pan-zoom.js";
import { MERGE_DEPARTURE, NODE_HEIGHT, NODE_WIDTH, TRACK_RADIUS, TRACK_SEPARATION, connector, layoutTree, } from "./tree-layout.js";
const MERGE_COLORS = [
    'light-dark(#a374d1,#b492e0)',
    'light-dark(#d1815e,#e0a07a)',
    'light-dark(#4f8f7d,#6fb3a0)',
];
function mergeStyle(index) {
    return { '--dsh-git-track-color': MERGE_COLORS[index % MERGE_COLORS.length] };
}
/** Compact tree visualization: node details are intentionally kept out of the graph. */
function GraphCanvasView({ state, previewNodeId, onPreview, selectedNodeIds, candidateNodeId, anchoredNodeIds, disabled = false, labels: suppliedLabels, }) {
    const locale = useLocale();
    const layout = useMemo(() => layoutTree(state), [state]);
    const automaticLabels = useMemo(() => nodeLabelMap(state), [state]);
    const labels = suppliedLabels ?? automaticLabels;
    const nodes = useMemo(() => orderedNodes(state), [state]);
    const byId = useMemo(() => new Map(layout.positions.map(position => [position.nodeId, position])), [layout]);
    const previewRelated = useMemo(() => {
        if (previewNodeId === null)
            return null;
        const preview = state.nodes[previewNodeId];
        if (preview === undefined)
            return null;
        const identityRoots = new Set([preview.id, ...preview.contextManifest]
            .filter(nodeId => state.nodes[nodeId] !== undefined)
            .map(nodeId => paIdentityId(state, nodeId)));
        return new Set(nodes
            .filter(node => identityRoots.has(paIdentityId(state, node.id)))
            .map(node => node.id));
    }, [state, nodes, previewNodeId]);
    const forkIdentityGroups = useMemo(() => {
        const groups = new Map();
        for (const node of nodes) {
            const identityRoot = paIdentityId(state, node.id);
            if (node.forkSourceId === undefined && identityRoot === node.id) {
                if (!groups.has(identityRoot))
                    groups.set(identityRoot, [identityRoot]);
                continue;
            }
            const members = groups.get(identityRoot) ?? (state.nodes[identityRoot] === undefined ? [] : [identityRoot]);
            if (!members.includes(node.id))
                members.push(node.id);
            groups.set(identityRoot, members);
        }
        return groups;
    }, [state, nodes]);
    const merges = useMemo(() => nodes.filter(node => node.forkSourceId === undefined && new Set(node.parentIds).size >= 2), [nodes]);
    const mergeIndex = useMemo(() => new Map(merges.map((node, index) => [node.id, index])), [merges]);
    const mergeSources = useMemo(() => new Set(merges.flatMap(node => node.parentIds)), [merges]);
    // Each source fans out in merge order. Shared sources keep one departure dot.
    const sourceTargets = useMemo(() => {
        const targets = new Map();
        for (const merge of merges) {
            for (const source of new Set(merge.parentIds)) {
                targets.set(source, [...(targets.get(source) ?? []), merge.id]);
            }
        }
        return targets;
    }, [merges]);
    const selectedNodes = useMemo(() => new Set(selectedNodeIds ?? []), [selectedNodeIds]);
    const anchoredNodes = useMemo(() => new Set(anchoredNodeIds ?? []), [anchoredNodeIds]);
    const selectionMode = selectedNodeIds !== undefined || candidateNodeId !== undefined;
    // The empty state renders no viewport, so both listeners have to re-bind
    // when the first PA turns this into a real canvas.
    const hasGraph = layout.positions.length > 0;
    const view = usePanZoom(layout, hasGraph);
    // Tabbing through nodes must not focus something parked off-canvas.
    const revealFocusedNode = (event) => {
        const nodeId = event.target.dataset?.nodeId;
        if (nodeId === undefined)
            return;
        const position = byId.get(nodeId);
        if (position === undefined)
            return;
        view.reveal({ left: position.x - NODE_WIDTH / 2, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT });
    };
    if (layout.positions.length === 0) {
        return _jsx("div", { className: "dsh-git-empty", children: localized('完成第一轮对话后，这里会出现第一条 branch。', 'The first branch will appear here after you complete a conversation turn.', locale) });
    }
    return _jsxs("div", { className: "dsh-git-tree-panel", children: [_jsxs("div", { className: "dsh-git-tree-legend", "aria-label": localized('图例', 'Graph legend', locale), children: [merges.map((node, index) => _jsxs("span", { style: mergeStyle(index), "data-merge-legend": node.id, children: [_jsx("i", {}), labels.get(node.id) ?? 'PA'] }, node.id)), _jsxs("span", { className: "dsh-git-tree-legend-lineage", children: [_jsx("i", {}), localized('血缘', 'Lineage', locale)] }), _jsx("span", { className: "dsh-git-tree-legend-count", children: localized(`${merges.length} 个 merge`, `${merges.length} merges`, locale) })] }), _jsxs("div", { ref: view.viewportRef, className: `dsh-git-tree-viewport ${view.panning ? 'dsh-git-tree-viewport-panning' : ''}`, ...view.handlers, onFocusCapture: revealFocusedNode, children: [_jsxs("div", { className: "dsh-git-tree-stage", style: {
                            width: layout.width,
                            height: layout.height,
                            transform: `translate(${view.transform.x}px, ${view.transform.y}px) scale(${view.transform.scale})`,
                        }, children: [_jsxs("svg", { className: "dsh-git-tree-svg", width: layout.width, height: layout.height, "aria-hidden": "true", children: [nodes.flatMap((node) => {
                                        if (node.forkSourceId !== undefined || mergeIndex.has(node.id))
                                            return [];
                                        return [...new Set(node.parentIds)].map((parentId) => {
                                            const parent = byId.get(parentId);
                                            const child = byId.get(node.id);
                                            if (parent === undefined || child === undefined)
                                                return null;
                                            return _jsx("path", { d: connector(parent, child), className: "dsh-git-tree-edge", "data-edge-kind": "lineage", "data-parent-id": parentId, "data-child-id": node.id }, `${parentId}:${node.id}`);
                                        });
                                    }), merges.map((node, index) => {
                                        const child = byId.get(node.id);
                                        if (child === undefined)
                                            return null;
                                        const targetX = child.x - NODE_WIDTH / 2;
                                        const targetY = child.y + NODE_HEIGHT / 2;
                                        const spineX = layout.mergeSpines.get(node.id);
                                        const sources = [...new Set(node.parentIds)].flatMap(parentId => {
                                            const parent = byId.get(parentId);
                                            if (parent === undefined)
                                                return [];
                                            const slot = sourceTargets.get(parentId)?.indexOf(node.id) ?? 0;
                                            const bendY = parent.y + NODE_HEIGHT + MERGE_DEPARTURE + slot * TRACK_SEPARATION;
                                            return [{ parent, bendY }];
                                        });
                                        if (sources.length === 0)
                                            return null;
                                        const spineStart = Math.min(...sources.map(source => source.bendY + TRACK_RADIUS));
                                        return _jsxs("g", { style: mergeStyle(index), "data-merge-id": node.id, children: [sources.map(({ parent, bendY }) => {
                                                    const direction = Math.sign(spineX - parent.x);
                                                    return _jsx("path", { d: `M ${parent.x} ${parent.y + NODE_HEIGHT} V ${bendY - TRACK_RADIUS} Q ${parent.x} ${bendY} ${parent.x + direction * TRACK_RADIUS} ${bendY} H ${spineX - direction * TRACK_RADIUS} Q ${spineX} ${bendY} ${spineX} ${bendY + TRACK_RADIUS}`, className: "dsh-git-tree-edge dsh-git-tree-edge-merge", "data-edge-kind": "merge", "data-parent-id": parent.nodeId, "data-child-id": node.id }, parent.nodeId);
                                                }), _jsx("path", { d: `M ${spineX} ${spineStart} V ${targetY - TRACK_RADIUS} Q ${spineX} ${targetY} ${spineX + TRACK_RADIUS} ${targetY} H ${targetX}`, className: "dsh-git-tree-edge dsh-git-tree-edge-merge", "data-merge-spine": node.id })] }, node.id);
                                    }), [...mergeSources].map(nodeId => {
                                        const source = byId.get(nodeId);
                                        return source === undefined ? null : _jsx("circle", { cx: source.x, cy: source.y + NODE_HEIGHT, r: 4, className: "dsh-git-tree-merge-source", "data-merge-source": nodeId }, nodeId);
                                    }), [...forkIdentityGroups].flatMap(([identityRoot, memberIds]) => {
                                        const members = memberIds
                                            .map(nodeId => byId.get(nodeId))
                                            .filter((position) => position !== undefined)
                                            .sort((left, right) => left.x - right.x);
                                        return members.slice(1).map((right, index) => {
                                            const left = members[index];
                                            const startX = left.x + NODE_WIDTH / 2 + 3;
                                            const endX = right.x - NODE_WIDTH / 2 - 3;
                                            const middleY = left.y + NODE_HEIGHT / 2;
                                            const muted = previewRelated !== null && !previewRelated.has(identityRoot);
                                            return _jsxs("g", { className: `dsh-git-tree-fork-arrow ${muted ? 'dsh-git-tree-fork-arrow-muted' : ''}`, "data-fork-source-id": identityRoot, "data-fork-from-id": left.nodeId, "data-fork-copy-id": right.nodeId, children: [_jsx("path", { d: `M ${startX} ${middleY} H ${endX}` }), _jsx("circle", { cx: startX, cy: middleY, r: 3 }), _jsx("circle", { cx: endX, cy: middleY, r: 3 })] }, `fork:${left.nodeId}:${right.nodeId}`);
                                        });
                                    })] }), layout.positions.map(position => {
                                const node = state.nodes[position.nodeId];
                                if (node === undefined)
                                    return null;
                                const label = labels.get(node.id) ?? 'PA';
                                const identityRoot = paIdentityId(state, node.id);
                                const visibleLabel = node.forkSourceId === undefined
                                    ? label
                                    : labels.get(identityRoot) ?? label.replace(/(?:\s+fork)+$/i, '');
                                const mergeParentCount = node.forkSourceId === undefined
                                    ? new Set(node.parentIds).size
                                    : 0;
                                const isHead = node.id === state.headNodeId;
                                const isPreview = node.id === previewNodeId;
                                const isDimmed = previewRelated !== null && !previewRelated.has(node.id);
                                const isSelected = selectedNodes.has(node.id);
                                const isCandidate = !isSelected && node.id === candidateNodeId;
                                const isAnchored = isSelected && anchoredNodes.has(node.id);
                                const selectionState = isSelected ? 'selected' : isCandidate ? 'candidate' : 'unselected';
                                return _jsxs("button", { type: "button", disabled: disabled, className: `dsh-git-tree-node ${isPreview ? 'dsh-git-tree-node-preview' : ''} ${isDimmed ? 'dsh-git-tree-node-dim' : ''} ${isSelected ? 'dsh-git-tree-node-selected' : ''} ${isCandidate ? 'dsh-git-tree-node-candidate' : ''}`, style: {
                                        ...(mergeIndex.has(node.id) ? mergeStyle(mergeIndex.get(node.id)) : {}),
                                        left: position.x - NODE_WIDTH / 2,
                                        top: position.y,
                                        width: NODE_WIDTH,
                                        height: NODE_HEIGHT,
                                    }, "aria-label": localized(`查看 ${label} context`, `View ${label} context`, locale), "aria-current": isHead ? 'true' : undefined, "aria-pressed": selectionMode ? (isSelected ? true : isCandidate ? 'mixed' : false) : undefined, "aria-controls": selectionMode ? 'dsh-git-pa-context-window' : undefined, "aria-expanded": selectionMode ? isPreview : undefined, "data-node-id": node.id, "data-layout-row": position.row, "data-layout-lane": position.lane, "data-selection-state": selectionMode ? selectionState : undefined, "data-anchor-state": isAnchored ? 'anchored' : undefined, onClick: () => onPreview(node.id), children: [mergeParentCount < 2 || !node.parentIds.some(id => byId.has(id)) ? null : _jsx("svg", { className: "dsh-git-tree-merge-target", width: "10", height: "10", "aria-hidden": "true", "data-merge-target": node.id, children: _jsx("circle", { cx: "5", cy: "5", r: "4.5" }) }), _jsx("span", { className: "dsh-git-tree-node-label", children: visibleLabel }), node.forkSourceId === undefined ? null : _jsx("span", { className: "dsh-git-tree-relation-tag", children: "FORK" }), mergeParentCount < 2 ? null : _jsxs("span", { className: "dsh-git-tree-relation-tag", children: ["MERGE\u00B7", mergeParentCount] }), isHead ? _jsx("span", { className: "dsh-git-tree-head", children: "HEAD" }) : null, isCandidate ? _jsx("span", { className: "dsh-git-tree-node-tag", children: localized('预览', 'preview', locale) }) : null] }, node.id);
                            })] }), _jsxs("div", { className: "dsh-git-tree-zoom", role: "group", "aria-label": localized('缩放', 'Zoom', locale), children: [_jsx("button", { type: "button", "aria-label": localized('缩小', 'Zoom out', locale), disabled: !view.canZoomOut, onClick: view.zoomOut, children: "\u2212" }), _jsxs("button", { type: "button", className: "dsh-git-tree-zoom-value", "aria-label": localized('居中并适应窗口', 'Center and fit to window', locale), onClick: view.resetView, children: [Math.round(view.transform.scale * 100), "%"] }), _jsx("button", { type: "button", "aria-label": localized('放大', 'Zoom in', locale), disabled: !view.canZoomIn, onClick: view.zoomIn, children: "+" })] })] })] });
}
/**
 * Memoized at the seam: laying out the tree is the most expensive render in
 * the workbench, and nothing about it changes while an answer streams beside
 * it. Callers must keep `state` and the id arrays referentially stable.
 */
export const GraphCanvas = memo(GraphCanvasView);
//# sourceMappingURL=GraphCanvas.js.map