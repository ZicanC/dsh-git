import type { GraphLayout, GraphState, TurnNode, TurnNodeId } from './types.ts';
/** Return nodes in stable creation order with ids breaking timestamp ties. */
export declare function orderedNodes(state: GraphState): readonly TurnNode[];
/** Return the primary-parent ancestry from root through the addressed node. */
export declare function primaryPath(state: GraphState, nodeId: TurnNodeId | null): readonly TurnNodeId[];
/** Return selected nodes whose primary parent is absent from the selection. */
export declare function missingDirectDependencies(state: GraphState, manifest: readonly TurnNodeId[]): readonly TurnNodeId[];
/**
 * Whether a selection joins lineages rather than continuing one.
 *
 * A selection drawn from a single Session — the current Chat's own history,
 * trimmed or reordered — branches that lineage: that is a Fork. Only PAs
 * pulled from a second Session make the new Chat a Merge.
 */
export declare function joinsLineages(state: GraphState, manifest: readonly TurnNodeId[]): boolean;
/** Assign stable lanes and parent edges for a compact GitLens-style graph. */
export declare function layoutGraph(state: GraphState): GraphLayout;
/** Estimate prompt tokens without coupling the browser plugin to a tokenizer. */
export declare function estimateTokens(state: GraphState, manifest: readonly TurnNodeId[]): number;
