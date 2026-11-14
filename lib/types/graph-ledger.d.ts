import type { GraphState, TurnNodeId } from './graph-state.ts';
/** Identity survives projection into another scope and does not depend on labels. */
export declare function identityOf(state: GraphState, id: TurnNodeId): string;
/** Append stable numbering in dependency order. Existing final events never move. */
export declare function finalizeGraph(state: GraphState): GraphState;
/** Semantic validation at the write boundary; malformed batches are never repaired silently. */
export declare function assertGraphSemantics(state: GraphState): void;
