import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query';
import type { ProjectSessionDTO, ProjectTurnDTO } from './protocol.ts';
/** Extract only balanced, completed, non-empty PA turns from one complete Session log. */
export declare function projectTurns(snapshot: SessionLogSnapshot): readonly ProjectTurnDTO[];
/** Convert one complete Session snapshot into the project graph wire record. */
export declare function projectSession(snapshot: SessionLogSnapshot): ProjectSessionDTO;
