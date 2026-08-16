import type { HistoryRailModel } from './history-rail.ts';
import type { TurnNodeId } from './types.ts';
export interface HistoryRailProps extends HistoryRailModel {
    readonly disabled?: boolean;
    /** The Chat History panel owns the full workbench after the graph is closed. */
    readonly expanded?: boolean;
    readonly onSelect: (nodeId: TurnNodeId) => void;
    /** Keeps the rail and the PA rendered in Chat History in lockstep. */
    readonly onActiveChange?: (nodeId: TurnNodeId | null) => void;
}
/**
 * The 30px conversation trail beside Chat History.
 *
 * Every dash is the PA at the same index in the right-hand preview. In compact
 * mode a dash stretches into its PA/title row. When Chat History owns the full
 * workbench, the same entries become rows whose hover card summarizes the PA.
 */
export declare function HistoryRail({ entries, includedCount, previewCount, disabled, expanded, onSelect, onActiveChange, }: HistoryRailProps): import("react").JSX.Element | null;
