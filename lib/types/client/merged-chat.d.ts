/** Creating a new Chat from the selected Context: a Fork or a Merge. */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ContextRef } from '../graph-state.ts';
import { type HostRpc } from './host-rpc.ts';
import type { GraphRepository } from './repository.ts';
import { type ComposerAccess } from './session-handoff.ts';
import type { TurnNodeId } from './types.ts';
/** The source Chat's draft as the view saw it when the user asked for the new Chat. */
export interface MergeDraftTransfer {
    /** The selection as history paths; derived from the manifest when omitted. */
    readonly contextRefs?: readonly ContextRef[];
    readonly text: string;
    readonly draftRevision: number;
    readonly attachmentIds: readonly DraftAttachmentId[];
    readonly hasStructuredReferences: boolean;
}
/** What creating a Chat needs from the browser. */
export interface MergedChatServices {
    readonly sessions: ISessions;
    readonly composers: ComposerAccess;
    readonly rpc: HostRpc;
    /** Show a Session in the main view. */
    readonly openSession: (sessionId: SessionId) => void;
    /** Keep a Session on a ledger until its Workspace membership reaches the browser. */
    readonly pinSession: (sessionId: SessionId, repository: GraphRepository) => void;
}
/**
 * Create a Chat whose history is the selected PAs, move the source Chat's
 * draft into it, and open it on the Branches tab.
 *
 * The Host composes the seed; the ledger records the child's lineage before
 * its Session reaches the browser. The draft moves only if it is still the
 * one the user saw, and never to a Chat that then fails to open.
 * @param manifest - the selected PAs in Context order.
 * @throws with a message for the user; unless it says otherwise the source
 *   draft is untouched.
 */
export declare function createMergedChat(services: MergedChatServices, repository: GraphRepository, sessionId: SessionId, manifest: readonly TurnNodeId[], draft: MergeDraftTransfer, signal: AbortSignal): Promise<void>;
