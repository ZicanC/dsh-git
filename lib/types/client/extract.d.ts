import type { ConversationNode, ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type { ImportedTurn } from './types.ts';
/**
 * Snapshot slice the extraction reads; `ConversationSnapshot` satisfies it.
 * Narrowing the parameter lets callers memoize on the two fields that matter
 * instead of on the whole snapshot, which swaps on every streamed delta.
 */
export interface CompletedTurnSource {
    readonly nodes: readonly ConversationNode[];
    readonly chat: {
        readonly timeline: ConversationTimelineSnapshot;
    };
}
/** Project completed DSH turns into Prompt + Answer records for the graph ledger. */
export declare function extractCompletedTurns(snapshot: CompletedTurnSource): readonly ImportedTurn[];
