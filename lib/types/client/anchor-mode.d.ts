/**
 * Anchor mode in the browser: fixing a set of PAs, leaving the mode, and
 * sending each question to its own child Session in the Anchor Workspace.
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import { type HostRpc } from './host-rpc.ts';
import type { GraphRepository } from './repository.ts';
import { type ComposerAccess } from './session-handoff.ts';
import type { AnchorModeState, TurnNodeId } from './types.ts';
/** What the anchored dispatch needs from the browser. */
export interface AnchorDispatchServices {
    readonly sessions: ISessions;
    readonly composers: ComposerAccess;
    readonly rpc: HostRpc;
}
/**
 * Fix the selected PAs and reuse or create their Anchor Workspace.
 * @param owner - the Workspace the source Chat belongs to, if any.
 * @returns the anchor now recorded for the source Session.
 */
export declare function activateAnchor(rpc: HostRpc, repository: GraphRepository, sessionId: string, owner: {
    readonly title: string;
} | undefined, manifest: readonly TurnNodeId[], signal: AbortSignal): Promise<AnchorModeState>;
/** Leave Anchor mode. The Host keeps the Anchor Workspace so the same PAs can resume it. */
export declare function cancelAnchor(rpc: HostRpc, repository: GraphRepository, sessionId: string, signal: AbortSignal): Promise<void>;
/**
 * Send the source Chat's draft as one question to a new child Session seeded
 * with the anchored PAs.
 *
 * The child is never shown, so it is retained here for exactly as long as the
 * question is on its way, and the source composer keeps the question until
 * the Host has taken it. Resolves without sending when the draft is empty.
 * @param anchor - the anchor as it was when the user pressed send.
 * @throws with a message for the user when the question was not sent; the
 *   source draft is then still where it was.
 */
export declare function dispatchAnchoredQuestion(services: AnchorDispatchServices, repository: GraphRepository, sessionId: SessionId, anchor: AnchorModeState, signal: AbortSignal): Promise<void>;
