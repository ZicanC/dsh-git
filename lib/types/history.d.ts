import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query';
import type { HistoryTurnSource } from './protocol.ts';
/** Copy one completed source turn into a detached target as a newly numbered real turn. */
export declare function appendHistoricalTurn(target: Session, sourceEvents: readonly SessionEvent[], targetTurn: number): void;
/** Read selected turns in tray order and produce a contiguous, balanced Agent seed. */
export declare function buildMergedSessionSeed(targetSessionId: string, sources: readonly HistoryTurnSource[], readSession: (sessionId: ReturnType<typeof SessionId>) => Promise<SessionLogSnapshot>): Promise<readonly SessionEvent[]>;
