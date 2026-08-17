import { orderedNodes } from "./graph.js";
/** Assign the same creation-order PA number everywhere the graph is rendered. */
export function nodeLabelMap(state) {
    const labels = new Map();
    const nodes = orderedNodes(state);
    for (const [index, node] of nodes.filter(candidate => candidate.forkSourceId === undefined).entries()) {
        labels.set(node.id, `PA${index + 1}`);
    }
    for (const node of nodes) {
        if (node.forkSourceId === undefined)
            continue;
        labels.set(node.id, `${labels.get(node.forkSourceId) ?? 'PA'} fork`);
    }
    return labels;
}
const PROJECT_NODE_ID = /^project-(pa|fork):(.*):(\d+)$/;
const HASH_MAX_LENGTH = 18;
function decodeSegment(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
/**
 * Short display hash kept out of primary node labels and shown only in the
 * inspector. Project-scoped ids carry a full session id, so they are summarised
 * down to the same compact shape instead of overflowing the heading.
 */
export function nodeHash(nodeId) {
    if (nodeId.startsWith('pa-'))
        return `PA-${nodeId.slice(-5)}`;
    const project = PROJECT_NODE_ID.exec(nodeId);
    if (project !== null) {
        const [, kind, session, turn] = project;
        return `${kind === 'fork' ? 'FORK' : 'PA'}-${decodeSegment(session ?? '').slice(-5)}:${turn}`;
    }
    if (nodeId.length <= HASH_MAX_LENGTH)
        return nodeId;
    return `${nodeId.slice(0, 6)}…${nodeId.slice(-5)}`;
}
//# sourceMappingURL=labels.js.map