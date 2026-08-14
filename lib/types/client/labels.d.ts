import type { GraphState, TurnNodeId } from './types.ts';
/** Assign the same creation-order PA number everywhere the graph is rendered. */
export declare function nodeLabelMap(state: GraphState): ReadonlyMap<TurnNodeId, string>;
/** Short display hash kept out of primary node labels and shown only in the inspector. */
export declare function nodeHash(nodeId: TurnNodeId): string;
