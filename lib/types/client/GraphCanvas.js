import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useCallback, useEffect, useMemo, useRef, useState, } from 'react';
import { orderedNodes } from "./graph.js";
import { nodeLabelMap } from "./labels.js";
import { localized, useLocale } from "./i18n.js";
// Nodes are readable text blocks, not chips: the accent lives on a 2px
// inline-start bar, so the box itself has to carry a label at rest.
const NODE_WIDTH = 132;
const NODE_HEIGHT = 42;
const HORIZONTAL_GAP = 24;
const VERTICAL_GAP = 58;
const LANE_STEP = NODE_WIDTH + HORIZONTAL_GAP;
const ROW_STEP = NODE_HEIGHT + VERTICAL_GAP;
const CONNECTOR_ELBOW = VERTICAL_GAP / 2;
const MERGE_PARALLEL_OFFSET = 8;
const STAGE_PADDING = 32;
// Zoom bounds for the pan/zoom stage. Below the floor the labels stop being
// readable; above the ceiling a single node fills the panel.
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2.5;
const ZOOM_STEP = 1.2;
// Breathing room kept around the graph when it is fitted into the viewport.
const FIT_PADDING = 16;
// Keyboard focus must not land on a node parked outside the visible area.
const FOCUS_MARGIN = 12;
function clampScale(scale) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}
/** Center the whole graph in the viewport, never magnifying past 1:1. */
function fitTransform(viewport, layout) {
    if (viewport.width === 0 || viewport.height === 0)
        return { x: 0, y: 0, scale: 1 };
    const usableWidth = Math.max(1, viewport.width - FIT_PADDING * 2);
    const usableHeight = Math.max(1, viewport.height - FIT_PADDING * 2);
    const scale = clampScale(Math.min(1, usableWidth / layout.width, usableHeight / layout.height));
    return {
        scale,
        x: (viewport.width - layout.width * scale) / 2,
        y: (viewport.height - layout.height * scale) / 2,
    };
}
/** Resolve an original PA and every fork copy to one presentation identity. */
function identityRootId(state, nodeId) {
    const visited = new Set();
    let cursor = nodeId;
    while (!visited.has(cursor)) {
        visited.add(cursor);
        const sourceId = state.nodes[cursor]?.forkSourceId;
        if (sourceId === undefined || state.nodes[sourceId] === undefined)
            return cursor;
        cursor = sourceId;
    }
    return cursor;
}
/**
 * Lay out the visible lineage rather than a creation-order list.
 *
 * Ordinary siblings share the row immediately below their parent. A fork copy
 * stays beside its source on the same row, while a merge always opens a fresh
 * lane to the right of the lineages it joins.
 */
function layoutTree(state) {
    const nodes = orderedNodes(state);
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    const rows = new Map();
    const measuringRows = new Set();
    const rowFor = (nodeId) => {
        const known = rows.get(nodeId);
        if (known !== undefined)
            return known;
        if (measuringRows.has(nodeId))
            return 0;
        const node = state.nodes[nodeId];
        if (node === undefined)
            return 0;
        measuringRows.add(nodeId);
        const identityRoot = identityRootId(state, node.id);
        const forkSource = identityRoot === node.id ? undefined : state.nodes[identityRoot];
        const row = forkSource === undefined ? (() => {
            const parentRows = [...new Set(node.parentIds)]
                .filter(parentId => parentId !== nodeId && state.nodes[parentId] !== undefined)
                .map(rowFor);
            return parentRows.length === 0 ? 0 : Math.max(...parentRows) + 1;
        })() : rowFor(forkSource.id);
        measuringRows.delete(nodeId);
        rows.set(nodeId, row);
        return row;
    };
    for (const node of nodes)
        rowFor(node.id);
    const ordinaryChildren = new Map();
    for (const node of nodes) {
        const parents = [...new Set(node.parentIds)];
        if (node.forkSourceId !== undefined || parents.length !== 1)
            continue;
        const parentId = parents[0];
        ordinaryChildren.set(parentId, [...(ordinaryChildren.get(parentId) ?? []), node.id]);
    }
    const forksBySource = new Map();
    for (const node of nodes) {
        if (node.forkSourceId === undefined)
            continue;
        const identityRoot = identityRootId(state, node.id);
        if (identityRoot === node.id || state.nodes[identityRoot] === undefined)
            continue;
        forksBySource.set(identityRoot, [...(forksBySource.get(identityRoot) ?? []), node.id]);
    }
    const lanes = new Map();
    const measuringLanes = new Set();
    // Slot availability is row-local. A busy earlier row must not make a later
    // sibling or merge inherit a large, visually empty global lane number.
    const rowHasLane = (row, lane) => {
        for (const [nodeId, occupied] of lanes) {
            if ((rows.get(nodeId) ?? 0) === row && occupied === lane)
                return true;
        }
        return false;
    };
    const nextFreeRowLane = (row, start) => {
        let lane = Math.max(0, start);
        while (rowHasLane(row, lane))
            lane += 1;
        return lane;
    };
    // A late fork owns the slot immediately to the right of its source. Only
    // the occupied suffix on that row moves; earlier/later rows keep their x,
    // and their connectors are allowed to bend to the moved endpoint.
    const openRowLane = (row, lane) => {
        if (!rowHasLane(row, lane))
            return;
        const suffix = [...lanes]
            .filter(([nodeId, occupied]) => (rows.get(nodeId) ?? 0) === row && occupied >= lane)
            .sort((left, right) => right[1] - left[1]);
        for (const [nodeId, occupied] of suffix)
            lanes.set(nodeId, occupied + 1);
    };
    const laneFor = (nodeId) => {
        const known = lanes.get(nodeId);
        if (known !== undefined)
            return known;
        if (measuringLanes.has(nodeId)) {
            const fallback = nextFreeRowLane(rows.get(nodeId) ?? 0, 0);
            lanes.set(nodeId, fallback);
            return fallback;
        }
        const node = state.nodes[nodeId];
        if (node === undefined)
            return 0;
        measuringLanes.add(nodeId);
        let lane;
        const identityRoot = identityRootId(state, node.id);
        const forkSource = identityRoot === node.id ? undefined : state.nodes[identityRoot];
        const parents = [...new Set(node.parentIds)]
            .filter(parentId => parentId !== nodeId && state.nodes[parentId] !== undefined);
        if (forkSource !== undefined) {
            const sourceLane = laneFor(forkSource.id);
            const siblings = forksBySource.get(forkSource.id) ?? [];
            const forkIndex = Math.max(0, siblings.indexOf(node.id));
            for (const earlierForkId of siblings.slice(0, forkIndex))
                laneFor(earlierForkId);
            lane = Math.max(sourceLane, ...siblings.slice(0, forkIndex)
                .map(forkId => lanes.get(forkId) ?? sourceLane)) + 1;
            openRowLane(rows.get(node.id) ?? 0, lane);
        }
        else if (parents.length >= 2) {
            for (const parentId of parents)
                laneFor(parentId);
            const rightmostParentLane = Math.max(...parents.map(parentId => lanes.get(parentId) ?? 0));
            lane = nextFreeRowLane(rows.get(node.id) ?? 0, rightmostParentLane + 1);
        }
        else if (parents.length === 1) {
            const parentId = parents[0];
            const parentLane = laneFor(parentId);
            const siblings = ordinaryChildren.get(parentId) ?? [];
            if (siblings[0] === node.id) {
                lane = nextFreeRowLane(rows.get(node.id) ?? 0, parentLane);
            }
            else {
                lane = nextFreeRowLane(rows.get(node.id) ?? 0, parentLane + 1);
            }
        }
        else if (node.primaryParentId !== null && state.nodes[node.primaryParentId] !== undefined) {
            lane = laneFor(node.primaryParentId);
        }
        else {
            lane = nextFreeRowLane(rows.get(node.id) ?? 0, 0);
        }
        measuringLanes.delete(nodeId);
        const placedDuringCycle = lanes.get(nodeId);
        if (placedDuringCycle !== undefined)
            return placedDuringCycle;
        lanes.set(nodeId, lane);
        return lane;
    };
    for (const node of nodes)
        laneFor(node.id);
    const positions = nodes
        .map(node => ({ node, row: rows.get(node.id) ?? 0, lane: lanes.get(node.id) ?? 0 }))
        .sort((left, right) => left.row - right.row || left.lane - right.lane
        || (order.get(left.node.id) ?? 0) - (order.get(right.node.id) ?? 0))
        .map(({ node, row, lane }) => ({
        nodeId: node.id,
        row,
        lane,
        x: STAGE_PADDING + NODE_WIDTH / 2 + lane * LANE_STEP,
        y: STAGE_PADDING + row * ROW_STEP,
    }));
    const maxRow = Math.max(0, ...positions.map(position => position.row));
    const maxLane = Math.max(0, ...positions.map(position => position.lane));
    return {
        positions,
        width: Math.max(320, STAGE_PADDING * 2 + NODE_WIDTH + maxLane * LANE_STEP),
        height: STAGE_PADDING * 2 + NODE_HEIGHT + maxRow * ROW_STEP,
    };
}
function connector(parent, child) {
    const startY = parent.y + NODE_HEIGHT;
    const endY = child.y;
    const middleY = startY + CONNECTOR_ELBOW;
    return `M ${parent.x} ${startY} V ${middleY} H ${child.x} V ${endY}`;
}
function mergeConnector(parent, child, parallel) {
    const startX = parent.x + (parallel ? MERGE_PARALLEL_OFFSET : 0);
    const startY = parent.y + NODE_HEIGHT;
    return `M ${startX} ${startY} V ${startY + CONNECTOR_ELBOW} H ${child.x} V ${child.y}`;
}
/** Compact tree visualization: node details are intentionally kept out of the graph. */
function GraphCanvasView({ state, previewNodeId, onPreview, selectedNodeIds, candidateNodeId, anchoredNodeIds, disabled = false, labels: suppliedLabels, }) {
    const locale = useLocale();
    const viewportRef = useRef(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const [panning, setPanning] = useState(false);
    // Once the user drives the canvas themselves, automatic re-centering stops
    // until they ask for it back through the fit control.
    const adjustedRef = useRef(false);
    const panRef = useRef(null);
    const layout = useMemo(() => layoutTree(state), [state]);
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
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
            .map(nodeId => identityRootId(state, nodeId)));
        return new Set(nodes
            .filter(node => identityRoots.has(identityRootId(state, node.id)))
            .map(node => node.id));
    }, [state, nodes, previewNodeId]);
    const forkIdentityGroups = useMemo(() => {
        const groups = new Map();
        for (const node of nodes) {
            const identityRoot = identityRootId(state, node.id);
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
    const parentsWithOrdinaryChildren = useMemo(() => new Set(nodes.flatMap((node) => {
        const parents = [...new Set(node.parentIds)];
        return node.forkSourceId === undefined && parents.length === 1 ? parents : [];
    })), [nodes]);
    const selectedNodes = useMemo(() => new Set(selectedNodeIds ?? []), [selectedNodeIds]);
    const anchoredNodes = useMemo(() => new Set(anchoredNodeIds ?? []), [anchoredNodeIds]);
    const selectionMode = selectedNodeIds !== undefined || candidateNodeId !== undefined;
    // The empty state renders no viewport, so both listeners have to re-bind
    // when the first PA turns this into a real canvas.
    const hasGraph = layout.positions.length > 0;
    useEffect(() => {
        const element = viewportRef.current;
        if (element === null)
            return;
        const update = () => setViewport(current => current.width === element.clientWidth && current.height === element.clientHeight
            ? current
            : { width: element.clientWidth, height: element.clientHeight });
        update();
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [hasGraph]);
    // Entering the graph — and every later resize or graph change the user has
    // not overridden — lands on a centered, fully visible view.
    useEffect(() => {
        if (adjustedRef.current)
            return;
        if (viewport.width === 0 || viewport.height === 0)
            return;
        setTransform(fitTransform(viewport, layout));
    }, [viewport, layout]);
    /** Zoom around a viewport-relative anchor so the point under it stays put. */
    const zoomBy = useCallback((factor, anchorX, anchorY) => {
        adjustedRef.current = true;
        setTransform((current) => {
            const scale = clampScale(current.scale * factor);
            if (scale === current.scale)
                return current;
            const ratio = scale / current.scale;
            return {
                scale,
                x: anchorX - (anchorX - current.x) * ratio,
                y: anchorY - (anchorY - current.y) * ratio,
            };
        });
    }, []);
    const resetView = useCallback(() => {
        const element = viewportRef.current;
        if (element === null)
            return;
        adjustedRef.current = false;
        setTransform(fitTransform({ width: element.clientWidth, height: element.clientHeight }, layoutRef.current));
    }, []);
    // Wheel must be a non-passive native listener: React's synthetic wheel
    // handler cannot cancel the surrounding page scroll.
    useEffect(() => {
        const element = viewportRef.current;
        if (element === null)
            return;
        const onWheel = (event) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
            if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
                const shift = (event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
                adjustedRef.current = true;
                setTransform(current => ({ ...current, x: current.x - shift }));
                return;
            }
            // Trackpad pinch arrives as ctrl+wheel with much smaller deltas.
            const intensity = event.ctrlKey || event.metaKey ? 0.01 : 0.002;
            zoomBy(Math.exp(-event.deltaY * unit * intensity), event.clientX - rect.left, event.clientY - rect.top);
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, [zoomBy, hasGraph]);
    const startPan = (event) => {
        if (event.button !== 0 && event.button !== 1)
            return;
        // Left-dragging a node is a click on that node, not a canvas pan.
        if (event.button === 0 && event.target.closest('button') !== null)
            return;
        // Middle-drag pans instead of arming the browser's autoscroll ring.
        if (event.button === 1)
            event.preventDefault();
        panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        setPanning(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const continuePan = (event) => {
        const pan = panRef.current;
        if (pan === null || pan.pointerId !== event.pointerId)
            return;
        const dx = event.clientX - pan.x;
        const dy = event.clientY - pan.y;
        panRef.current = { pointerId: pan.pointerId, x: event.clientX, y: event.clientY };
        adjustedRef.current = true;
        setTransform(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
    };
    const endPan = (event) => {
        if (panRef.current?.pointerId !== event.pointerId)
            return;
        panRef.current = null;
        setPanning(false);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
    };
    // Tabbing through nodes must not focus something parked off-canvas.
    const revealFocusedNode = (event) => {
        const nodeId = event.target.dataset?.nodeId;
        if (nodeId === undefined)
            return;
        const position = byId.get(nodeId);
        const element = viewportRef.current;
        if (position === undefined || element === null)
            return;
        setTransform((current) => {
            const left = (position.x - NODE_WIDTH / 2) * current.scale + current.x;
            const top = position.y * current.scale + current.y;
            const right = left + NODE_WIDTH * current.scale;
            const bottom = top + NODE_HEIGHT * current.scale;
            const dx = left < FOCUS_MARGIN
                ? FOCUS_MARGIN - left
                : right > element.clientWidth - FOCUS_MARGIN ? element.clientWidth - FOCUS_MARGIN - right : 0;
            const dy = top < FOCUS_MARGIN
                ? FOCUS_MARGIN - top
                : bottom > element.clientHeight - FOCUS_MARGIN ? element.clientHeight - FOCUS_MARGIN - bottom : 0;
            return dx === 0 && dy === 0 ? current : { ...current, x: current.x + dx, y: current.y + dy };
        });
    };
    if (layout.positions.length === 0) {
        return _jsx("div", { className: "dsh-git-empty", children: localized('完成第一轮对话后，这里会出现第一条 branch。', 'The first branch will appear here after you complete a conversation turn.', locale) });
    }
    const zoomAtCenter = (factor) => zoomBy(factor, viewport.width / 2, viewport.height / 2);
    return _jsxs("div", { ref: viewportRef, className: `dsh-git-tree-viewport ${panning ? 'dsh-git-tree-viewport-panning' : ''}`, onPointerDown: startPan, onPointerMove: continuePan, onPointerUp: endPan, onPointerCancel: endPan, onDoubleClick: event => { if (event.target.closest('button') === null)
            resetView(); }, onFocusCapture: revealFocusedNode, children: [_jsxs("div", { className: "dsh-git-tree-stage", style: {
                    width: layout.width,
                    height: layout.height,
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                }, children: [_jsxs("svg", { className: "dsh-git-tree-svg", width: layout.width, height: layout.height, "aria-hidden": "true", children: [nodes.flatMap((node) => {
                                if (node.forkSourceId !== undefined)
                                    return [];
                                const parentIds = [...new Set(node.parentIds)];
                                const merge = parentIds.length >= 2;
                                return parentIds.map((parentId) => {
                                    const parent = byId.get(parentId);
                                    const child = byId.get(node.id);
                                    if (parent === undefined || child === undefined)
                                        return null;
                                    return _jsx("path", { d: merge
                                            ? mergeConnector(parent, child, parentsWithOrdinaryChildren.has(parentId))
                                            : connector(parent, child), className: `dsh-git-tree-edge ${merge ? 'dsh-git-tree-edge-merge' : ''}`, "data-edge-kind": merge ? 'merge' : 'lineage', "data-parent-id": parentId, "data-child-id": node.id }, `${parentId}:${node.id}`);
                                });
                            }), [...forkIdentityGroups].flatMap(([identityRoot, memberIds]) => {
                                const members = memberIds
                                    .map(nodeId => byId.get(nodeId))
                                    .filter((position) => position !== undefined)
                                    .sort((left, right) => left.x - right.x);
                                return members.slice(1).map((right, index) => {
                                    const left = members[index];
                                    const startX = left.x + NODE_WIDTH / 2;
                                    const endX = right.x - NODE_WIDTH / 2;
                                    const middleY = left.y + NODE_HEIGHT / 2;
                                    const muted = previewRelated !== null && !previewRelated.has(identityRoot);
                                    return _jsxs("g", { className: `dsh-git-tree-fork-arrow ${muted ? 'dsh-git-tree-fork-arrow-muted' : ''}`, "data-fork-source-id": identityRoot, "data-fork-from-id": left.nodeId, "data-fork-copy-id": right.nodeId, children: [_jsx("path", { d: `M ${startX} ${middleY} H ${endX}` }), _jsx("path", { d: `M ${startX + 4} ${middleY - 3.5} L ${startX} ${middleY} L ${startX + 4} ${middleY + 3.5}` }), _jsx("path", { d: `M ${endX - 4} ${middleY - 3.5} L ${endX} ${middleY} L ${endX - 4} ${middleY + 3.5}` })] }, `fork:${left.nodeId}:${right.nodeId}`);
                                });
                            })] }), layout.positions.map(position => {
                        const node = state.nodes[position.nodeId];
                        if (node === undefined)
                            return null;
                        const label = labels.get(node.id) ?? 'PA';
                        const identityRoot = identityRootId(state, node.id);
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
                                left: position.x - NODE_WIDTH / 2,
                                top: position.y,
                                width: NODE_WIDTH,
                                height: NODE_HEIGHT,
                            }, "aria-label": localized(`查看 ${label} context`, `View ${label} context`, locale), "aria-current": isHead ? 'true' : undefined, "aria-pressed": selectionMode ? (isSelected ? true : isCandidate ? 'mixed' : false) : undefined, "aria-controls": selectionMode ? 'dsh-git-pa-context-window' : undefined, "aria-expanded": selectionMode ? isPreview : undefined, "data-node-id": node.id, "data-layout-row": position.row, "data-layout-lane": position.lane, "data-selection-state": selectionMode ? selectionState : undefined, "data-anchor-state": isAnchored ? 'anchored' : undefined, onClick: () => onPreview(node.id), children: [_jsx("span", { className: "dsh-git-tree-node-label", children: visibleLabel }), node.forkSourceId === undefined ? null : _jsx("span", { className: "dsh-git-tree-relation-tag", children: "FORK" }), mergeParentCount < 2 ? null : _jsxs("span", { className: "dsh-git-tree-relation-tag", children: ["MERGE\u00B7", mergeParentCount] }), isHead ? _jsx("span", { className: "dsh-git-tree-head", children: "HEAD" }) : null, isCandidate ? _jsx("span", { className: "dsh-git-tree-node-tag", children: localized('预览', 'preview', locale) }) : null] }, node.id);
                    })] }), _jsxs("div", { className: "dsh-git-tree-zoom", role: "group", "aria-label": localized('缩放', 'Zoom', locale), children: [_jsx("button", { type: "button", "aria-label": localized('缩小', 'Zoom out', locale), disabled: transform.scale <= MIN_SCALE + 0.001, onClick: () => zoomAtCenter(1 / ZOOM_STEP), children: "\u2212" }), _jsxs("button", { type: "button", className: "dsh-git-tree-zoom-value", "aria-label": localized('居中并适应窗口', 'Center and fit to window', locale), onClick: resetView, children: [Math.round(transform.scale * 100), "%"] }), _jsx("button", { type: "button", "aria-label": localized('放大', 'Zoom in', locale), disabled: transform.scale >= MAX_SCALE - 0.001, onClick: () => zoomAtCenter(ZOOM_STEP), children: "+" })] })] });
}
/**
 * Memoized at the seam: laying out the tree is the most expensive render in
 * the workbench, and nothing about it changes while an answer streams beside
 * it. Callers must keep `state` and the id arrays referentially stable.
 */
export const GraphCanvas = memo(GraphCanvasView);
//# sourceMappingURL=GraphCanvas.js.map