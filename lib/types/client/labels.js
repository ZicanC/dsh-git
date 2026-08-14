import { orderedNodes } from "./graph.js";
/** Assign the same creation-order PA number everywhere the graph is rendered. */
export function nodeLabelMap(state) {
    return new Map(orderedNodes(state).map((node, index) => [node.id, `PA${index + 1}`]));
}
/** Short display hash kept out of primary node labels and shown only in the inspector. */
export function nodeHash(nodeId) {
    return nodeId.startsWith('pa-') ? `PA-${nodeId.slice(-5)}` : nodeId;
}
//# sourceMappingURL=labels.js.map