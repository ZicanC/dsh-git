import type {
  GraphEdge, GraphLayout, GraphPosition, GraphState, TurnNode, TurnNodeId,
} from './types.ts'

/** Return nodes in stable creation order with ids breaking timestamp ties. */
export function orderedNodes(state: GraphState): readonly TurnNode[] {
  return Object.values(state.nodes).sort((left, right) =>
    left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

/** Return the primary-parent ancestry from root through the addressed node. */
export function primaryPath(state: GraphState, nodeId: TurnNodeId | null): readonly TurnNodeId[] {
  const reversed: TurnNodeId[] = []
  const visited = new Set<TurnNodeId>()
  let cursor = nodeId
  while (cursor !== null && !visited.has(cursor)) {
    const node = state.nodes[cursor]
    if (node === undefined) break
    visited.add(cursor)
    reversed.push(cursor)
    cursor = node.primaryParentId
  }
  return reversed.reverse()
}

/** Return selected nodes whose primary parent is absent from the selection. */
export function missingDirectDependencies(
  state: GraphState,
  manifest: readonly TurnNodeId[],
): readonly TurnNodeId[] {
  const selected = new Set(manifest)
  const missing = new Set<TurnNodeId>()
  for (const id of manifest) {
    const parent = state.nodes[id]?.primaryParentId
    if (parent !== null && parent !== undefined && !selected.has(parent)) missing.add(parent)
  }
  return [...missing]
}

/**
 * Whether a selection joins lineages rather than continuing one.
 *
 * A selection drawn from a single Session — the current Chat's own history,
 * trimmed or reordered — branches that lineage: that is a Fork. Only PAs
 * pulled from a second Session make the new Chat a Merge.
 */
export function joinsLineages(state: GraphState, manifest: readonly TurnNodeId[]): boolean {
  const sessions = new Set(manifest.flatMap((id) => {
    const node = state.nodes[id]
    return node === undefined ? [] : [node.sessionId]
  }))
  return sessions.size > 1
}

/** Assign stable lanes and parent edges for a compact GitLens-style graph. */
export function layoutGraph(state: GraphState): GraphLayout {
  const nodes = orderedNodes(state)
  const childCount = new Map<TurnNodeId, number>()
  const lanes = new Map<TurnNodeId, number>()
  const positions: GraphPosition[] = []
  const edges: GraphEdge[] = []
  let nextLane = 0

  for (const [row, node] of nodes.entries()) {
    let lane: number
    if (node.primaryParentId === null) {
      lane = nextLane++
    } else {
      const parentLane = lanes.get(node.primaryParentId)
      const siblings = childCount.get(node.primaryParentId) ?? 0
      lane = parentLane !== undefined && siblings === 0 ? parentLane : nextLane++
      childCount.set(node.primaryParentId, siblings + 1)
    }
    lanes.set(node.id, lane)
    positions.push({ nodeId: node.id, row, lane })
    for (const parentId of node.parentIds) {
      if (state.nodes[parentId] === undefined) continue
      edges.push({ parentId, childId: node.id, merge: parentId !== node.primaryParentId })
    }
  }

  return { positions, edges, laneCount: Math.max(1, nextLane) }
}

/** Estimate prompt tokens without coupling the browser plugin to a tokenizer. */
export function estimateTokens(state: GraphState, manifest: readonly TurnNodeId[]): number {
  const characters = manifest.reduce((total, id) => {
    const node = state.nodes[id]
    return total + (node === undefined ? 0 : node.prompt.length + node.answer.length)
  }, 0)
  return Math.ceil(characters / 4)
}
