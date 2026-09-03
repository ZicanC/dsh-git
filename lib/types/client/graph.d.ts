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
/** Resolve every visual fork copy to the original PA identity it represents. */
export declare function paIdentityId(state: GraphState, nodeId: TurnNodeId): TurnNodeId;
/**
 * Keep one occurrence per PA identity without moving its original Tray slot.
 *
 * Selecting another fork copy replaces the occurrence stored in that slot;
 * it never adds a second copy of the same PA to the outgoing Context.
 */
export declare function normalizeContextOccurrences(state: GraphState, manifest: readonly TurnNodeId[]): readonly TurnNodeId[];
/** Parent endpoints derived from one ordered Context Tray snapshot. */
export interface LineageParentPlan {
    readonly parentIds: readonly TurnNodeId[];
    readonly primaryParentId: TurnNodeId | null;
}
/**
 * Keep only the last selected PA from each source Session.
 *
 * The surviving endpoints retain the order of their own final Tray positions,
 * rather than the order in which their Sessions first appeared. The final
 * surviving endpoint is therefore also the layout-primary parent.
 */
export declare function lineageParentPlan(state: GraphState, manifest: readonly TurnNodeId[]): LineageParentPlan;
/** Assign stable lanes and parent edges for a compact GitLens-style graph. */
export declare function layoutGraph(state: GraphState): GraphLayout;
/** Estimate prompt tokens without coupling the browser plugin to a tokenizer. */
export declare function estimateTokens(state: GraphState, manifest: readonly TurnNodeId[]): number;
