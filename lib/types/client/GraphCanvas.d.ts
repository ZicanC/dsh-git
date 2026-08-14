import type { GraphState, TurnNodeId } from './types.ts';
/** Presentation-only props for the compact conversation tree. */
export interface GraphCanvasProps {
    readonly state: GraphState;
    readonly previewNodeId: TurnNodeId | null;
    readonly onPreview: (nodeId: TurnNodeId) => void;
    /** Optional project-level PA labels ordered by completion time. */
    readonly labels?: ReadonlyMap<TurnNodeId, string>;
    /** Optional stable color index per project Session. */
    readonly nodeColors?: ReadonlyMap<TurnNodeId, number>;
    /** Disable fit-to-viewport so large project graphs remain scrollable. */
    readonly fit?: boolean;
}
/** Compact tree visualization: node details are intentionally kept out of the graph. */
export declare function GraphCanvas({ state, previewNodeId, onPreview, labels: suppliedLabels, nodeColors, fit, }: GraphCanvasProps): import("react").JSX.Element;
