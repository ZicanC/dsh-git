import type { GraphState, TurnNode, TurnNodeId } from './types.ts';
import type { ContextRef } from '../graph-state.ts';
/** Freeze the history path independently from the physical node's owner. */
export declare function contextReferences(state: GraphState, manifest: readonly TurnNodeId[], via?: Readonly<Record<string, string>>): readonly ContextRef[];
export declare function resolveContextReferences(state: GraphState, refs: readonly ContextRef[]): readonly TurnNodeId[];
/** Return nodes in stable creation order with ids breaking timestamp ties. */
export declare function orderedNodes(state: GraphState): readonly TurnNode[];
/**
 * Whether a selection joins lineages rather than continuing one.
 *
 * A selection drawn from a single Session — the current Chat's own history,
 * trimmed or reordered — branches that lineage: that is a Fork. Only PAs
 * pulled from a second Session make the new Chat a Merge.
 */
export declare function joinsLineages(state: GraphState, manifest: readonly TurnNodeId[], refs?: readonly ContextRef[]): boolean;
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
export declare function lineageParentPlan(state: GraphState, manifest: readonly TurnNodeId[], refs?: readonly ContextRef[]): LineageParentPlan;
/** Estimate prompt tokens without coupling the browser plugin to a tokenizer. */
export declare function estimateTokens(state: GraphState, manifest: readonly TurnNodeId[]): number;
