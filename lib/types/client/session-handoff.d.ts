/**
 * Handing a draft from the Chat on screen to a Session the plugin just created.
 *
 * A Session has a binding in the browser only while something retains it, and
 * the last release tears its scope down together with any unsent draft. The
 * helpers here hold such a Session for as long as a draft is on its way into
 * it, move the draft's attachments, and tell when the Host has taken a send.
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ISessions, SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type { DraftAttachmentId, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
declare module '@deepseek-ai/dsh-api-session-controller/client' {
    interface SessionReferenceSourceMap {
        /** A dsh-git operation holding a Session it created or reads but does not display. */
        dshGit: unknown;
    }
}
/** The composers of retained Sessions, and the service that stages their uploads. */
export interface ComposerAccess {
    /** The composer of a Session that is currently retained. */
    inputFor(binding: SessionBinding): SessionInput;
    /** The `ctx.conversation` service, probed at runtime for its draft staging face. */
    readonly conversation: unknown;
}
export declare function sameValues<T>(left: readonly T[], right: readonly T[]): boolean;
/**
 * Retain a Session the Host has just created for this plugin.
 *
 * The caller keeps the returned reference until the draft it placed has
 * either been sent or handed to the main view.
 * @returns the opened reference, or undefined when the Session cannot be opened.
 */
export declare function retainCreatedSession(sessions: ISessions, sessionId: SessionId, signal: AbortSignal): Promise<SessionReference | undefined>;
/**
 * Wait for the submission started on a composer to settle.
 *
 * The composer is frozen while the Host admits a message. An accepted message
 * empties it; a refused one returns it to editing with the draft intact.
 * @returns whether the Host took the message.
 * @throws when the signal aborts first.
 */
export declare function submissionAccepted(input: SessionInput, signal: AbortSignal): Promise<boolean>;
/** A draft's attachments handed to another composer, with the way back. */
export type AttachmentHandOver = {
    readonly ok: true;
    /** Resolves once the receiving Session can send every attachment. */
    readonly whenReady: (signal: AbortSignal) => Promise<void>;
    /** Take the attachments back, for a draft that stays with its source after all. */
    readonly undo: () => void;
} | {
    readonly ok: false;
};
/**
 * Hand a draft's attachments to another Session's composer and stage their
 * uploads for it, as Harness does when a draft follows a Workspace switch.
 * The source composer keeps listing them until the caller clears it.
 * @returns the hand-over, or `ok: false` with nothing moved.
 */
export declare function handOverAttachments(conversation: unknown, ids: readonly DraftAttachmentId[], source: SessionBinding, target: SessionBinding, targetInput: SessionInput): AttachmentHandOver;
/**
 * Select the plugin's tab once navigation has created the opened Session's header.
 * @returns whether the tab ended up selected before the attempts ran out.
 */
export declare function activateBranchesTab(sessions: ISessions, sessionId: SessionId): Promise<boolean>;
