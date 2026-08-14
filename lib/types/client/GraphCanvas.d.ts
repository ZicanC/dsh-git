import type { GraphState, TurnNodeId } from './types.ts';
/** Presentation-only props for the compact conversation tree. */
export interface GraphCanvasProps {
    readonly state: GraphState;
    readonly previewNodeId: TurnNodeId | null;
    readonly onPreview: (nodeId: TurnNodeId) => void;
}
/** Compact tree visualization: node details are intentionally kept out of the graph. */
export declare function GraphCanvas({ state, previewNodeId, onPreview }: GraphCanvasProps): import("react").JSX.Element;
