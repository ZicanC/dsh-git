import type { GraphState, TurnNodeId } from './types.ts';
export interface PAContextWindowProps {
    readonly state: GraphState;
    readonly nodeId: TurnNodeId;
    readonly label: string;
    readonly selected: boolean;
    readonly disabled: boolean;
    readonly onAdd: () => void;
    readonly onRemove: () => void;
    readonly onClose: () => void;
}
/**
 * Compact summary of one PA selection: number, title, hash, the Context that
 * answered it, and the explicit commit/remove action. The prompt and answer
 * bodies stay in Chat History rather than being repeated here.
 */
export declare function PAContextWindow({ state, nodeId, label, selected, disabled, onAdd, onRemove, onClose, }: PAContextWindowProps): import("react").JSX.Element | null;
