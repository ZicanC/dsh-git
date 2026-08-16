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
/** Details and the explicit commit/remove action for one PA selection. */
export declare function PAContextWindow({ state, nodeId, label, selected, disabled, onAdd, onRemove, onClose, }: PAContextWindowProps): import("react").JSX.Element | null;
