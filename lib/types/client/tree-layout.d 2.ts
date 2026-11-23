import type { GraphState, TurnNodeId } from './types.ts';
export declare const NODE_WIDTH = 132;
export declare const NODE_HEIGHT = 42;
export declare const HORIZONTAL_GAP = 24;
export declare const TRACK_RADIUS = 12;
export declare const TRACK_SEPARATION = 6;
/** How far below a source node its first merge track turns towards the merge. */
export declare const MERGE_DEPARTURE = 23;
export interface TreePosition {
    readonly nodeId: TurnNodeId;
    readonly row: number;
    readonly lane: number;
    readonly x: number;
    readonly y: number;
}
export interface TreeLayout {
    readonly positions: readonly TreePosition[];
    readonly mergeSpines: ReadonlyMap<TurnNodeId, number>;
    readonly width: number;
    readonly height: number;
}
/**
 * Lay out the visible lineage rather than a creation-order list.
 *
 * Ordinary siblings share the row immediately below their parent. A fork copy
 * stays beside its source on the same row, while a merge always opens a fresh
 * lane to the right of the lineages it joins.
 */
export declare function layoutTree(state: GraphState): TreeLayout;
/** Path of an ordinary lineage edge from a parent down to its child. */
export declare function connector(parent: TreePosition, child: TreePosition): string;
