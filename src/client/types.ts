/** Stable id of one Prompt + Answer turn in the conversation DAG. */
export type TurnNodeId = string

/** Stable id of one visual branch. */
export type BranchId = string

/** One extracted completed DSH turn. */
export interface ImportedTurn {
  readonly turn: number
  readonly prompt: string
  readonly answer: string
  readonly createdAt: number
  readonly boundarySeq: number
}

/** One immutable Prompt + Answer commit in the conversation DAG. */
export interface TurnNode {
  readonly id: TurnNodeId
  readonly sessionId: string
  readonly turn: number
  readonly prompt: string
  readonly answer: string
  readonly createdAt: number
  readonly boundarySeq: number
  readonly primaryParentId: TurnNodeId | null
  readonly parentIds: readonly TurnNodeId[]
  readonly contextManifest: readonly TurnNodeId[]
  readonly branchId: BranchId
}

/** One named branch and its latest completed node. */
export interface ConversationBranch {
  readonly id: BranchId
  readonly name: string
  readonly sessionId: string
  readonly headId: TurnNodeId | null
  readonly color: number
  readonly createdAt: number
}

/** Pending merge metadata retained until the child session completes its first new turn. */
export interface PendingMerge {
  readonly branchId: BranchId
  readonly parentIds: readonly TurnNodeId[]
  readonly primaryParentId: TurnNodeId | null
  readonly contextManifest: readonly TurnNodeId[]
  readonly prompt: string
}

/** Durable browser state of the graph and next-request tray. */
export interface GraphState {
  readonly format: 1
  readonly nodes: Readonly<Record<TurnNodeId, TurnNode>>
  readonly branches: Readonly<Record<BranchId, ConversationBranch>>
  readonly sessionBranches: Readonly<Record<string, BranchId>>
  readonly sessionTurnRefs: Readonly<Record<string, Readonly<Record<number, TurnNodeId>>>>
  readonly pendingMerges: Readonly<Record<string, PendingMerge>>
  readonly headNodeId: TurnNodeId | null
  readonly previewNodeId: TurnNodeId | null
  readonly contextManifest: readonly TurnNodeId[]
}

/** Inputs for preparing an automatically forked merge branch. */
export interface PrepareBranchInput {
  readonly sourceSessionId: string
  readonly childSessionId: string
  readonly baseNodeId: TurnNodeId
  /** Nodes already materialized as Turns 1..N in the new Host-side session seed. */
  readonly importedNodeIds: readonly TurnNodeId[]
  readonly parentIds: readonly TurnNodeId[]
  readonly primaryParentId: TurnNodeId | null
  readonly contextManifest: readonly TurnNodeId[]
  readonly prompt: string
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
