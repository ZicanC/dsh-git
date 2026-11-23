/**
 * Moving a draft's attachments from one Session's composer to another's.
 *
 * Harness stages a draft attachment's upload against the Session it was added
 * to, and the Host resolves an upload receipt only for that Session's Agent.
 * Handing the attachment ids to another composer is therefore not enough: the
 * uploads must be staged again for the receiving Session, or its send fails.
 *
 * Harness performs that step itself when a draft follows a Workspace switch,
 * through `rebindDraftFiles` and the `fileUploads` store on its Conversation
 * service. Neither is part of the outward `IConversation` contract, so this
 * module detects them at runtime instead of assuming them. When they are
 * missing, callers refuse to move a draft that carries attachments and leave
 * it where it is.
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client';
/** Re-stages a moved draft's uploads for the Session that now owns them. */
export interface DraftAttachmentStaging {
    /**
     * Start staging the uploads again for `sessionId`.
     * @param uploadImages - whether that Session stages image uploads; an image
     *   draft otherwise sends its bytes with the prompt.
     */
    restage(sessionId: SessionId, ids: readonly DraftAttachmentId[], uploadImages: boolean): void;
    /**
     * Wait until every listed draft can be sent: its upload is ready, or it has
     * none and sends inline.
     * @throws when an upload fails or the signal aborts.
     */
    whenReady(ids: readonly DraftAttachmentId[], signal: AbortSignal): Promise<void>;
}
/**
 * Resolve the staging face of the Conversation service.
 * @param conversation - the `ctx.conversation` service.
 * @returns the staging face, or undefined when this Harness does not expose it.
 */
export declare function draftAttachmentStaging(conversation: unknown): DraftAttachmentStaging | undefined;
