import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query';
import type { HistoryTurnSource } from './protocol.ts';
type SystemMessage = SessionEvent<'system/message'>['data']['message'];
/**
 * The system message a seed opens with, until it has been written.
 *
 * Harness stores a log only if every `system/message` on a non-empty surface
 * is preceded by a system message that was the surface's very first node. The
 * loop writes the child's system prompt on its first request, after the copied
 * history — so a seed whose surface began with a user message would produce a
 * log that can no longer be read once the child has run a turn.
 */
export interface SeedHead {
    readonly message: SystemMessage;
    placed: boolean;
}
/**
 * The system message in effect at one point of a source log: the last
 * surviving system node that carries a prompt, else the first system node.
 * @param throughSeq - inclusive seq the surface is folded through.
 * @returns the message, or undefined when the log has no system node there.
 */
export declare function effectiveSystemMessage(events: readonly SessionEvent[], throughSeq: number): SystemMessage | undefined;
/**
 * Copy one completed source turn into a detached target as a newly numbered real turn.
 * @param head - the seed's opening system message; written as the first
 *   surface node, inside the first step the copied turns open.
 */
export declare function appendHistoricalTurn(target: Session, sourceEvents: readonly SessionEvent[], targetTurn: number, head?: SeedHead): void;
/**
 * Read selected turns in tray order and produce a contiguous, balanced Agent seed.
 *
 * The seed closes with the log-only `dsh-git/merge` lineage event, appended
 * directly rather than through `Session.append` because only a seed event may
 * carry `ignorable` (see `./merge-lineage.ts`).
 * @param forkOriginOf - the Session an official fork was taken from, for a
 *   fork whose header records no parent (see `./fork-origin.ts`).
 */
export declare function buildMergedSessionSeed(targetSessionId: string, sources: readonly HistoryTurnSource[], readSession: (sessionId: ReturnType<typeof SessionId>) => Promise<SessionLogSnapshot>, forkOriginOf?: (snapshot: SessionLogSnapshot) => Promise<string | undefined>): Promise<readonly SessionEvent[]>;
export {};
