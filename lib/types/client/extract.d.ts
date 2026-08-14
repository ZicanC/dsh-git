import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type { ImportedTurn } from './types.ts';
/** Project completed DSH turns into Prompt + Answer records for the graph ledger. */
export declare function extractCompletedTurns(snapshot: ConversationSnapshot): readonly ImportedTurn[];
