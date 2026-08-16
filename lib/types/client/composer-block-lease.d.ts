import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client';
/**
 * Own only dsh-git's composer block while coexisting with other blockers.
 *
 * The Host registry currently stores one value per Session rather than one
 * value per plugin. This lease never clears a foreign value. While active it
 * watches the slot and reasserts its own block only after another owner has
 * released theirs.
 */
export declare class ComposerBlockLease {
    private readonly blocks;
    private readonly sessionId;
    private readonly reason;
    private ownedBlock;
    private stop;
    private desired;
    constructor(blocks: IConversation['blocks'], sessionId: SessionId, reason: () => string);
    /** Raise or release this owner's block without disturbing a foreign owner. */
    setBlocked(blocked: boolean): boolean;
    /** Release this lease and its subscription. */
    dispose(): void;
    private reconcile;
    private release;
}
