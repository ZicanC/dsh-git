/**
 * The durable conversation-graph ledger, shared by both bundle halves.
 *
 * Types only — the Host owns the storage domain and its zod schemas
 * (`./graph-domain.ts`), the browser owns the observable repository
 * (`./client/repository.ts`), and neither may pull the other's runtime in.
 */
/** Stable id of one Prompt + Answer turn in the conversation DAG. */
export type TurnNodeId = string;
/** Stable id of one visual branch. */
export type BranchId = string;
/** One immutable Prompt + Answer commit in the conversation DAG. */
export interface TurnNode {
    readonly id: TurnNodeId;
    readonly sessionId: string;
    readonly turn: number;
    readonly prompt: string;
    readonly answer: string;
    readonly createdAt: number;
    readonly boundarySeq: number;
    readonly primaryParentId: TurnNodeId | null;
    readonly parentIds: readonly TurnNodeId[];
    readonly contextManifest: readonly TurnNodeId[];
    readonly branchId: BranchId;
    /** Visual copy of the source PA at which an ordinary Harness fork begins. */
    readonly forkSourceId?: TurnNodeId | undefined;
}
/** One named branch and its latest completed node. */
export interface ConversationBranch {
    readonly id: BranchId;
    readonly name: string;
    readonly sessionId: string;
    readonly headId: TurnNodeId | null;
    readonly color: number;
    readonly createdAt: number;
}
/** Pending merge metadata retained until the child session completes its first new turn. */
export interface PendingMerge {
    readonly branchId: BranchId;
    readonly parentIds: readonly TurnNodeId[];
    readonly primaryParentId: TurnNodeId | null;
    readonly contextManifest: readonly TurnNodeId[];
    readonly prompt: string;
}
/**
 * One scope's complete ledger: the DAG, its branches, and the view state.
 *
 * Held per Workspace folder (`workspace:<id>`) or, for a Session outside every
 * folder, per Session (`session:<id>`). The whole record is the unit of
 * durability — one `put` per mutation — so a reader never observes a graph
 * whose edges and refs disagree.
 */
export interface GraphState {
    readonly format: 1;
    readonly nodes: Readonly<Record<TurnNodeId, TurnNode>>;
    readonly branches: Readonly<Record<BranchId, ConversationBranch>>;
    readonly sessionBranches: Readonly<Record<string, BranchId>>;
    readonly sessionTurnRefs: Readonly<Record<string, Readonly<Record<number, TurnNodeId>>>>;
    readonly pendingMerges: Readonly<Record<string, PendingMerge>>;
    readonly headNodeId: TurnNodeId | null;
    readonly previewNodeId: TurnNodeId | null;
    readonly contextManifest: readonly TurnNodeId[];
}
/** The ledger a scope starts from before its first completed turn. */
export declare const EMPTY_GRAPH_STATE: GraphState;
