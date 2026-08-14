import { orderedNodes } from './graph.ts'
import type { GraphState, TurnNodeId } from './types.ts'

/** Assign the same creation-order PA number everywhere the graph is rendered. */
export function nodeLabelMap(state: GraphState): ReadonlyMap<TurnNodeId, string> {
  return new Map(orderedNodes(state).map((node, index) => [node.id, `PA${index + 1}`]))
}

/** Short display hash kept out of primary node labels and shown only in the inspector. */
export function nodeHash(nodeId: TurnNodeId): string {
  return nodeId.startsWith('pa-') ? `PA-${nodeId.slice(-5)}` : nodeId
}
