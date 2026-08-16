import type { GraphState, TurnNodeId } from './types.ts';
/** How one turn participates in the merge the workbench is composing. */
export type HistoryRailState = 'included' | 'preview';
/** One row of the conversation trail, and the dash that stands in for it. */
export interface HistoryRailEntry {
    readonly nodeId: TurnNodeId;
    readonly label: string;
    /** Single-line prompt shown on the row. */
    readonly prompt: string;
    readonly state: HistoryRailState;
    readonly head: boolean;
    /** Branch depth, capped so a deep DAG never pushes the prompt out of view. */
    readonly indent: number;
    /** Whether the row belongs to a visible side branch and needs an elbow. */
    readonly branched: boolean;
    /** Dash width in px, mapped from this turn's estimated token weight. */
    readonly width: number;
}
/** Complete drawing model for the Chat History rail. */
export interface HistoryRailModel {
    readonly entries: readonly HistoryRailEntry[];
    readonly includedCount: number;
    readonly previewCount: number;
}
/** Which turns the rail lists, and how each of them is currently marked. */
export interface HistoryRailInput {
    readonly selectedIds: readonly TurnNodeId[];
    readonly candidateId: TurnNodeId | null;
    readonly headNodeId: TurnNodeId | null;
    /**
     * The exact Context order rendered by Chat History, including a candidate at
     * its tentative insertion point. Unselected nodes are never added to the
     * floating rail, even if a stale ordering input still mentions one.
     */
    readonly orderedIds?: readonly TurnNodeId[];
}
export declare const EMPTY_HISTORY_RAIL: HistoryRailModel;
/**
 * Build the rail from exactly the committed Context plus its one candidate.
 * The ordering follows Chat History, while every unselected graph node stays
 * out of the floating rail.
 *
 * Indentation reuses the lane rule the graph itself draws with — a turn keeps
 * its parent's lane only as that parent's first child, so a second child reads
 * as a branch off the spine.
 */
export declare function historyRailModel(state: GraphState, input: HistoryRailInput): HistoryRailModel;
