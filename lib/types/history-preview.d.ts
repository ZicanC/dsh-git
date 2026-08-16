import { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query';
import { type HistoryPreviewResponse, type HistoryTurnSource } from './protocol.ts';
/**
 * Project selected turns through the actual merged-seed builder, so the preview
 * and a later Merge share source validation, event filtering, and tray order.
 */
export declare function projectHistoryPreview(sources: readonly HistoryTurnSource[], readSession: (sessionId: ReturnType<typeof SessionId>) => Promise<SessionLogSnapshot>): Promise<HistoryPreviewResponse>;
