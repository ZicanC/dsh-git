import type { GraphState, TurnNodeId } from './types.ts';
export declare const MIN_SCALE = 0.25;
export declare const MAX_SCALE = 2.5;
/** Presentation-only props for the compact conversation tree. */
export interface GraphCanvasProps {
    readonly state: GraphState;
    readonly previewNodeId: TurnNodeId | null;
    readonly onPreview: (nodeId: TurnNodeId) => void;
    /** Optional committed selection. Supplying this enables selection semantics. */
    readonly selectedNodeIds?: readonly TurnNodeId[];
    /** Optional uncommitted node being previewed for addition. */
    readonly candidateNodeId?: TurnNodeId | null;
    /** Make node inspection inert while a merge transaction is in flight. */
    readonly disabled?: boolean;
    /** Optional project-level PA labels ordered by completion time. */
    readonly labels?: ReadonlyMap<TurnNodeId, string>;
    /** Optional stable color index per project Session. */
    readonly nodeColors?: ReadonlyMap<TurnNodeId, number>;
}
/** Compact tree visualization: node details are intentionally kept out of the graph. */
declare function GraphCanvasView({ state, previewNodeId, onPreview, selectedNodeIds, candidateNodeId, disabled, labels: suppliedLabels, nodeColors, }: GraphCanvasProps): import("react").JSX.Element;
/**
 * Memoized at the seam: laying out the tree is the most expensive render in
 * the workbench, and nothing about it changes while an answer streams beside
 * it. Callers must keep `state` and the id arrays referentially stable.
 */
export declare const GraphCanvas: import("react").MemoExoticComponent<typeof GraphCanvasView>;
export {};
