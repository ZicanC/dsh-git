export type { ContextRef, AnchorModeState, BranchId, ConversationBranch, GraphState, PendingMerge, TurnNode, TurnNodeId, } from '../graph-state.ts';
export { EMPTY_GRAPH_STATE } from '../graph-state.ts';
import type { ContextRef, TurnNodeId } from '../graph-state.ts';
/** One extracted completed DSH turn. */
export interface ImportedTurn {
    readonly turn: number;
    readonly prompt: string;
    readonly answer: string;
    readonly createdAt: number;
    readonly boundarySeq: number;
}
/** Inputs for registering a merged Session before its first new official turn. */
export interface PrepareMergedSessionInput {
    readonly contextRefs?: readonly ContextRef[] | undefined;
    readonly childSessionId: string;
    /** Nodes already materialized as Turns 1..N in the new Host-side session seed. */
    readonly importedNodeIds: readonly TurnNodeId[];
    readonly parentIds: readonly TurnNodeId[];
    readonly primaryParentId: TurnNodeId | null;
    readonly contextManifest: readonly TurnNodeId[];
}
