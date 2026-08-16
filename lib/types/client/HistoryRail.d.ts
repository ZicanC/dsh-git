import type { HistoryRailModel } from './history-rail.ts';
import type { TurnNodeId } from './types.ts';
export interface HistoryRailProps extends HistoryRailModel {
    readonly disabled?: boolean;
    readonly onSelect: (nodeId: TurnNodeId) => void;
    /** Keeps the rail and the PA rendered in Chat History in lockstep. */
    readonly onActiveChange?: (nodeId: TurnNodeId | null) => void;
}
/**
 * The 30px conversation trail beside Chat History.
 *
 * Every dash is the PA at the same index in the right-hand preview. Hovering a
 * dash stretches that dash into its PA/title row; it never substitutes an
 * answer card or a second, independently ordered list.
 */
export declare function HistoryRail({ entries, includedCount, previewCount, disabled, onSelect, onActiveChange, }: HistoryRailProps): import("react").JSX.Element | null;
