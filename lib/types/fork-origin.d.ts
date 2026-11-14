import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query';
/**
 * The Session a fork inherited its prefix from.
 *
 * A parent recorded in the header (Harness before 0.2.1-rc.3, and every
 * Session this plugin composes) is returned as it is. Otherwise the origin is
 * the candidate that holds the inherited prefix verbatim and wrote its last
 * event itself: a sibling fork of the same prefix inherited that event too, so
 * it is not where the history comes from.
 * @param candidates - Sessions the origin may be among; the fork itself is skipped.
 * @returns the origin's Session id, or undefined when the Session is not a
 *   fork or its origin is not among the candidates.
 */
export declare function forkOrigin(fork: SessionLogSnapshot, candidates: Iterable<SessionLogSnapshot>): string | undefined;
