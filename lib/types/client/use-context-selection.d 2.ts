import type { AnchorModeState, GraphState, TurnNodeId } from './types.ts';
/** The selection and the edits the view can make to it. */
export interface ContextSelection {
    /** The Chat's own history: what the selection is when nothing was edited. */
    readonly currentSessionIds: readonly TurnNodeId[];
    /** The selected PAs, in Context order. */
    readonly selectedIds: readonly TurnNodeId[];
    /** The history the selection was last reset to; a difference from it is an unmerged edit. */
    readonly baselineIds: readonly TurnNodeId[];
    /** The PA whose Context window is open, if any. Inspecting never changes the selection. */
    readonly inspectedId: TurnNodeId | null;
    /** Whether the selection differs from the Chat's own history. Never true while anchored. */
    readonly dirty: boolean;
    /** The Session each selected PA is reached through, by node id. */
    readonly sources: Readonly<Record<string, string>>;
    /** Open a PA's Context window. @returns false when the selection is locked. */
    readonly inspect: (nodeId: TurnNodeId) => boolean;
    /** Close the Context window and return focus to the node that opened it. */
    readonly closeInspector: () => void;
    /** Add the inspected PA, replacing another occurrence of the same PA in place. */
    readonly addInspected: () => void;
    readonly remove: (nodeId: TurnNodeId) => void;
    /** Move a selected PA in front of another. */
    readonly move: (nodeId: TurnNodeId, beforeId: TurnNodeId) => void;
    readonly moveEnd: (nodeId: TurnNodeId) => void;
    /**
     * Return to the Chat's own history and follow it again.
     * @param forgetPaths - also drop the Sessions that PAs were re-reached through.
     */
    readonly reset: (forgetPaths: boolean) => void;
}
/**
 * Own the Context selection of one Branches view.
 *
 * Untouched, the selection is the Chat's own history and follows it: a turn
 * that completes joins it. The first edit stops that; undoing every edit
 * starts it again. While an anchor is active the selection is the anchored
 * PAs and cannot be edited.
 * @param state - the graph the selection is drawn from.
 * @param anchor - the active anchor of this Chat, if any.
 * @param locked - whether edits are refused: an action is in flight, or the Chat is anchored.
 */
export declare function useContextSelection(state: GraphState, sessionId: string, anchor: AnchorModeState | undefined, locked: boolean): ContextSelection;
