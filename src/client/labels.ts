import { orderedNodes } from './graph.ts'
import type { GraphState, TurnNodeId } from './types.ts'

/** Assign the same creation-order PA number everywhere the graph is rendered. */
export function nodeLabelMap(state: GraphState): ReadonlyMap<TurnNodeId, string> {
  const labels = new Map<TurnNodeId, string>()
  const nodes = orderedNodes(state)
  for (const [index, node] of nodes.filter(candidate => candidate.forkSourceId === undefined).entries()) {
    labels.set(node.id, `PA${index + 1}`)
  }
  for (const node of nodes) {
    if (node.forkSourceId === undefined) continue
    labels.set(node.id, `${labels.get(node.forkSourceId) ?? 'PA'} fork`)
  }
  return labels
}

/** Short display hash kept out of primary node labels and shown only in the inspector. */
export function nodeHash(nodeId: TurnNodeId): string {
  return nodeId.startsWith('pa-') ? `PA-${nodeId.slice(-5)}` : nodeId
}
