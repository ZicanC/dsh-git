export type {
  BranchId, ConversationBranch, GraphState, PendingMerge, TurnNode, TurnNodeId,
} from '../graph-state.ts'
export { EMPTY_GRAPH_STATE } from '../graph-state.ts'

import type { TurnNodeId } from '../graph-state.ts'

/** One extracted completed DSH turn. */
export interface ImportedTurn {
  readonly turn: number
  readonly prompt: string
  readonly answer: string
  readonly createdAt: number
  readonly boundarySeq: number
}

/** Inputs for registering a merged Session before its first new official turn. */
export interface PrepareMergedSessionInput {
  readonly childSessionId: string
  /** Nodes already materialized as Turns 1..N in the new Host-side session seed. */
  readonly importedNodeIds: readonly TurnNodeId[]
  readonly parentIds: readonly TurnNodeId[]
  readonly primaryParentId: TurnNodeId | null
  readonly contextManifest: readonly TurnNodeId[]
}

/** One graph node's deterministic drawing position. */
export interface GraphPosition {
  readonly nodeId: TurnNodeId
  readonly row: number
  readonly lane: number
}

/** One directed edge drawn from a parent into its child. */
export interface GraphEdge {
  readonly parentId: TurnNodeId
  readonly childId: TurnNodeId
  readonly merge: boolean
}

/** Complete deterministic drawing model for the GitLens-style graph. */
export interface GraphLayout {
  readonly positions: readonly GraphPosition[]
  readonly edges: readonly GraphEdge[]
  readonly laneCount: number
}
