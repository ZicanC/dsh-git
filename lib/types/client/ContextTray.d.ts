import type { GraphState, TurnNodeId } from './types.ts';
/** Presentation props for the ordered, page-local merge selection. */
export interface ContextTrayProps {
    readonly state: GraphState;
    readonly selectedIds: readonly TurnNodeId[];
    readonly candidateId: TurnNodeId | null;
    readonly busy: boolean;
    readonly error: string | null;
    readonly dirty: boolean;
    readonly draftHasContent: boolean;
    readonly overLimit: boolean;
    readonly onMove: (nodeId: TurnNodeId, beforeId: TurnNodeId) => void;
    readonly onMoveEnd: (nodeId: TurnNodeId) => void;
    readonly onRemove: (nodeId: TurnNodeId) => void;
    readonly onClear: () => void;
    readonly onMerge: () => Promise<void>;
    readonly onDiscard: (send: boolean) => void;
}
/** Draggable ordered PA selection. The resident DSH composer remains below it. */
export declare function ContextTray({ state, selectedIds, candidateId, busy, error, dirty, draftHasContent, overLimit, onMove, onMoveEnd, onRemove, onClear, onMerge, onDiscard, }: ContextTrayProps): import("react").JSX.Element;
