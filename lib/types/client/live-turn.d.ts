/**
 * Live tail projection: the turns the official Chat is still streaming.
 *
 * Chat History renders Host-projected records for turns that already exist as
 * graph PAs. A turn only becomes a PA after it closes, so without this module
 * the panel stays silent from send until completion. The official conversation
 * view solves the same problem from `ConversationSnapshot`: finalized nodes,
 * the in-progress `partial` assistant, and the unsettled `runningCalls`. This
 * projects exactly those three sources into the same record vocabulary the
 * preview already renders, so one component draws both halves.
 */
import type { ConversationNode, ConversationTimelineSnapshot, PartialAssistant, RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client';
import type { HistoryPreviewRecord } from '../protocol.ts';
/** Snapshot slice the live tail reads; `ConversationSnapshot` satisfies it. */
export interface LiveTurnSource {
    readonly nodes: readonly ConversationNode[];
    readonly chat: {
        readonly timeline: ConversationTimelineSnapshot;
    };
    readonly partial: PartialAssistant | null;
    readonly runningCalls: readonly RunningToolCall[];
}
/** One still-running turn rendered under the settled Chat History sections. */
export interface LiveTurnView {
    /** Stable React key across the whole streaming lifetime of the turn. */
    readonly key: string;
    readonly turn: number;
    readonly records: readonly HistoryPreviewRecord[];
}
/**
 * Project every open turn the graph does not own yet.
 *
 * Open is the load-bearing half of that condition: a closed turn is a PA the
 * moment the view syncs it, so projecting closed turns would duplicate the
 * whole loaded window on the first render after a mount, before that sync
 * lands. Only a turn that is still producing output has no PA to defer to.
 *
 * @param source - the live conversation slice of the current Session.
 * @param afterTurn - highest turn number already registered as a graph PA.
 * @returns ordered live sections; empty whenever nothing is running.
 */
export declare function projectLiveTurns(source: LiveTurnSource, afterTurn: number): readonly LiveTurnView[];
