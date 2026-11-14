import { orderedNodes } from './graph.ts'
import type { GraphState, TurnNodeId } from './types.ts'

/** Assign the same creation-order PA number everywhere the graph is rendered. */
export function nodeLabelMap(state: GraphState): ReadonlyMap<TurnNodeId, string> {
  const labels = new Map<TurnNodeId, string>()
  const nodes = orderedNodes(state)
  const ordinary = nodes.filter(candidate => candidate.forkSourceId === undefined)
  const reserved = new Set<number>()
  for (const node of ordinary) {
    if (node.displayLabel === undefined && node.ledgerOrdinal === undefined) continue
    labels.set(node.id, node.displayLabel ?? `PA${node.ledgerOrdinal}`)
    if (node.ledgerOrdinal !== undefined) reserved.add(node.ledgerOrdinal)
    const match = /^PA([1-9]\d*)(?: fork)?$/.exec(node.displayLabel ?? '')
    if (match !== null) reserved.add(Number(match[1]))
  }
  let next = reserved.size === 0 ? 1 : Math.max(...reserved) + 1
  for (const node of ordinary) {
    if (labels.has(node.id)) continue
    while (reserved.has(next)) next += 1
    labels.set(node.id, `PA${node.ledgerOrdinal ?? next}`)
    reserved.add(next)
    next += 1
  }
  for (const node of nodes) {
    if (node.forkSourceId === undefined) continue
    labels.set(node.id, `${labels.get(node.forkSourceId) ?? 'PA'} fork`)
  }
  return labels
}

const PROJECT_NODE_ID = /^project-(pa|fork):(.*):(\d+)$/
const HASH_MAX_LENGTH = 18

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Short display hash kept out of primary node labels and shown only in the
 * inspector. Project-scoped ids carry a full session id, so they are summarised
 * down to the same compact shape instead of overflowing the heading.
 */
export function nodeHash(nodeId: TurnNodeId): string {
  if (nodeId.startsWith('pa-')) return `PA-${nodeId.slice(-5)}`
  const project = PROJECT_NODE_ID.exec(nodeId)
  if (project !== null) {
    const [, kind, session, turn] = project
    return `${kind === 'fork' ? 'FORK' : 'PA'}-${decodeSegment(session ?? '').slice(-5)}:${turn}`
  }
  if (nodeId.length <= HASH_MAX_LENGTH) return nodeId
  return `${nodeId.slice(0, 6)}…${nodeId.slice(-5)}`
}
