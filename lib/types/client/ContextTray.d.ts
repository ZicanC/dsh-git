import type { GraphState, TurnNodeId } from './types.ts';
/** Presentation-only props for the ordered next-request context tray. */
export interface ContextTrayProps {
    readonly state: GraphState;
    readonly busy: boolean;
    readonly error: string | null;
    readonly onMove: (nodeId: TurnNodeId, beforeId: TurnNodeId) => void;
    readonly onMoveEnd: (nodeId: TurnNodeId) => void;
    readonly onRemove: (nodeId: TurnNodeId) => void;
    readonly onClear: () => void;
    readonly onAsk: (question: string) => Promise<void>;
}
/** Draggable ordered context selection and branch-creating prompt composer. */
export declare function ContextTray({ state, busy, error, onMove, onMoveEnd, onRemove, onClear, onAsk, }: ContextTrayProps): import("react").JSX.Element;
