import { estimateTokens, orderedNodes } from "./graph.js";
import { nodeLabelMap } from "./labels.js";
const MIN_DASH = 9;
const MAX_DASH = 18;
const MAX_INDENT = 3;
export const EMPTY_HISTORY_RAIL = {
    entries: [], includedCount: 0, previewCount: 0,
};
function oneLine(value, maximum) {
    const collapsed = value.replace(/\s+/g, ' ').trim();
    return collapsed.length <= maximum ? collapsed : `${collapsed.slice(0, maximum - 1)}…`;
}
function answerTitle(value) {
    const first = value.split(/\r?\n/).map(line => line.trim()).find(line => line !== '') ?? '';
    return oneLine(first.replace(/^#{1,6}\s+/, ''), 42);
}
/**
 * Build the rail from exactly the committed Context plus its one candidate.
 * The ordering follows Chat History, while every unselected graph node stays
 * out of the floating rail.
 *
 * Indentation reuses the lane rule the graph itself draws with — a turn keeps
 * its parent's lane only as that parent's first child, so a second child reads
 * as a branch off the spine.
 */
export function historyRailModel(state, input) {
    const included = new Set(input.selectedIds);
    const candidate = input.candidateId !== null && !included.has(input.candidateId)
        ? input.candidateId
        : null;
    const visible = new Set(input.selectedIds);
    if (candidate !== null)
        visible.add(candidate);
    const graphNodes = orderedNodes(state);
    const trajectoryNodes = graphNodes.filter(node => visible.has(node.id));
    if (trajectoryNodes.length === 0)
        return EMPTY_HISTORY_RAIL;
    const byId = new Map(trajectoryNodes.map(node => [node.id, node]));
    const preferredIds = input.orderedIds ?? trajectoryNodes.map(node => node.id);
    const orderedIds = [];
    const seen = new Set();
    const append = (nodeId) => {
        if (seen.has(nodeId) || !byId.has(nodeId))
            return;
        seen.add(nodeId);
        orderedIds.push(nodeId);
    };
    preferredIds.forEach(append);
    trajectoryNodes.forEach(node => append(node.id));
    const nodes = orderedIds.flatMap(nodeId => {
        const node = byId.get(nodeId);
        return node === undefined ? [] : [node];
    });
    const labels = nodeLabelMap(state);
    const lanes = new Map();
    const childCount = new Map();
    const branched = new Map();
    let nextLane = 1;
    // Compute lanes in graph order so a user reordering Context does not invent
    // or erase topology. Independent roots always restart on the spine.
    for (const node of graphNodes) {
        const parentId = node.primaryParentId;
        const parentLane = parentId === null ? undefined : lanes.get(parentId);
        if (parentId === null || parentLane === undefined) {
            lanes.set(node.id, 0);
            branched.set(node.id, false);
            continue;
        }
        const siblings = childCount.get(parentId) ?? 0;
        childCount.set(parentId, siblings + 1);
        const lane = siblings === 0 ? parentLane : nextLane++;
        lanes.set(node.id, lane);
        branched.set(node.id, lane > 0);
    }
    const weights = nodes.map(node => estimateTokens(state, [node.id]));
    const lightest = Math.min(...weights);
    const heaviest = Math.max(...weights);
    const span = heaviest - lightest;
    const entries = nodes.map((node, index) => {
        const weight = weights[index] ?? 0;
        return {
            nodeId: node.id,
            label: labels.get(node.id) ?? 'PA',
            prompt: oneLine(node.prompt, 120),
            summaryTitle: answerTitle(node.answer),
            summary: oneLine(node.answer, 180),
            state: included.has(node.id) ? 'included' : 'preview',
            head: node.id === input.headNodeId,
            indent: Math.min(lanes.get(node.id) ?? 0, MAX_INDENT),
            branched: branched.get(node.id) ?? false,
            width: span === 0
                ? Math.round((MIN_DASH + MAX_DASH) / 2)
                : MIN_DASH + Math.round(((weight - lightest) / span) * (MAX_DASH - MIN_DASH)),
        };
    });
    return {
        entries,
        includedCount: entries.filter(entry => entry.state === 'included').length,
        previewCount: entries.filter(entry => entry.state === 'preview').length,
    };
}
//# sourceMappingURL=history-rail.js.map