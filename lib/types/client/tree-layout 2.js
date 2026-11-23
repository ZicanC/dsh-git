/**
 * Geometry of the conversation tree: where each PA sits and how its
 * connectors are drawn. Pure functions of a graph ledger; `./GraphCanvas.tsx`
 * renders the result and `./pan-zoom.ts` moves it around.
 */
import { orderedNodes, paIdentityId } from "./graph.js";
// Nodes are readable text blocks, not chips: the accent lives on a 2px
// inline-start bar, so the box itself has to carry a label at rest.
export const NODE_WIDTH = 132;
export const NODE_HEIGHT = 42;
export const HORIZONTAL_GAP = 24;
const VERTICAL_GAP = 58;
const LANE_STEP = NODE_WIDTH + HORIZONTAL_GAP;
const ROW_STEP = NODE_HEIGHT + VERTICAL_GAP;
const CONNECTOR_ELBOW = VERTICAL_GAP / 2;
export const TRACK_RADIUS = 12;
export const TRACK_SEPARATION = 6;
const STAGE_PADDING = 32;
/** How far below a source node its first merge track turns towards the merge. */
export const MERGE_DEPARTURE = 23;
/**
 * Lay out the visible lineage rather than a creation-order list.
 *
 * Ordinary siblings share the row immediately below their parent. A fork copy
 * stays beside its source on the same row, while a merge always opens a fresh
 * lane to the right of the lineages it joins.
 */
export function layoutTree(state) {
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
        const identityRoot = paIdentityId(state, node.id);
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
        const identityRoot = paIdentityId(state, node.id);
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
        const identityRoot = paIdentityId(state, node.id);
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
    // Reused target columns still need distinct merge spines. Widen only those
    // gutters, and unusually busy departure rows, instead of stacking tracks.
    const mergeSlots = new Map();
    const gutterCounts = new Map();
    const departures = new Map();
    for (const node of nodes) {
        if (node.forkSourceId !== undefined || new Set(node.parentIds).size < 2)
            continue;
        const lane = lanes.get(node.id) ?? 0;
        const slot = gutterCounts.get(lane) ?? 0;
        mergeSlots.set(node.id, slot);
        gutterCounts.set(lane, slot + 1);
        for (const parentId of new Set(node.parentIds)) {
            departures.set(parentId, (departures.get(parentId) ?? 0) + 1);
        }
    }
    const rowExtras = new Map();
    for (const [nodeId, count] of departures) {
        const row = rows.get(nodeId) ?? 0;
        rowExtras.set(row, Math.max(rowExtras.get(row) ?? 0, MERGE_DEPARTURE + (count - 1) * TRACK_SEPARATION + TRACK_RADIUS - VERTICAL_GAP, 0));
    }
    const extraX = (lane) => [...gutterCounts]
        .reduce((sum, [column, count]) => sum + (column <= lane ? (count - 1) * TRACK_SEPARATION : 0), 0);
    const extraY = (row) => [...rowExtras]
        .reduce((sum, [sourceRow, extra]) => sum + (sourceRow < row ? extra : 0), 0);
    const positions = nodes
        .map(node => ({ node, row: rows.get(node.id) ?? 0, lane: lanes.get(node.id) ?? 0 }))
        .sort((left, right) => left.row - right.row || left.lane - right.lane
        || (order.get(left.node.id) ?? 0) - (order.get(right.node.id) ?? 0))
        .map(({ node, row, lane }) => ({
        nodeId: node.id,
        row,
        lane,
        x: STAGE_PADDING + NODE_WIDTH / 2 + lane * LANE_STEP + extraX(lane),
        y: STAGE_PADDING + row * ROW_STEP + extraY(row),
    }));
    const maxRow = Math.max(0, ...positions.map(position => position.row));
    const maxLane = Math.max(0, ...positions.map(position => position.lane));
    return {
        positions,
        mergeSpines: new Map(positions.filter(position => mergeSlots.has(position.nodeId))
            .map(position => [position.nodeId, position.x - NODE_WIDTH / 2 - HORIZONTAL_GAP / 2
                - mergeSlots.get(position.nodeId) * TRACK_SEPARATION])),
        width: Math.max(320, STAGE_PADDING * 2 + NODE_WIDTH + maxLane * LANE_STEP + extraX(maxLane)),
        height: STAGE_PADDING * 2 + NODE_HEIGHT + maxRow * ROW_STEP + extraY(maxRow),
    };
}
/** Round orthogonal corners in either direction, including shifted late forks. */
function roundedTrack(points) {
    const first = points[0];
    let path = `M ${first[0]} ${first[1]}`;
    for (let index = 1; index < points.length - 1; index += 1) {
        const before = points[index - 1];
        const corner = points[index];
        const after = points[index + 1];
        const incoming = Math.hypot(corner[0] - before[0], corner[1] - before[1]);
        const outgoing = Math.hypot(after[0] - corner[0], after[1] - corner[1]);
        const radius = Math.min(TRACK_RADIUS, incoming / 2, outgoing / 2);
        if (radius === 0)
            continue;
        const entry = [corner[0] - Math.sign(corner[0] - before[0]) * radius,
            corner[1] - Math.sign(corner[1] - before[1]) * radius];
        const exit = [corner[0] + Math.sign(after[0] - corner[0]) * radius,
            corner[1] + Math.sign(after[1] - corner[1]) * radius];
        path += ` L ${entry[0]} ${entry[1]} Q ${corner[0]} ${corner[1]} ${exit[0]} ${exit[1]}`;
    }
    const last = points.at(-1);
    return `${path} L ${last[0]} ${last[1]}`;
}
/** Path of an ordinary lineage edge from a parent down to its child. */
export function connector(parent, child) {
    const startY = parent.y + NODE_HEIGHT;
    if (parent.x === child.x)
        return `M ${parent.x} ${startY} V ${child.y}`;
    const middleY = startY + CONNECTOR_ELBOW;
    return roundedTrack([[parent.x, startY], [parent.x, middleY], [child.x, middleY], [child.x, child.y]]);
}
//# sourceMappingURL=tree-layout.js.map