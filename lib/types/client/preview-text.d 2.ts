/**
 * Text projections for the Chat History preview: one-line summaries, readable
 * tool arguments, and the provenance of an injected context message. Pure, so
 * the row components in `./PreviewRecords.tsx` stay markup.
 */
import type { HistoryPreviewContentBlock, HistoryPreviewJsonValue } from '../protocol.ts';
export declare function json(value: HistoryPreviewJsonValue): string;
export declare function oneLine(value: string, maximum?: number): string;
export declare function sourceKind(source: HistoryPreviewJsonValue): string | null;
/** Same durable-source projection used by the official Context Injection row. */
export declare function previewContextProvenance(source: HistoryPreviewJsonValue): {
    role: 'inject' | 'recall';
    label: string | null;
};
export declare function firstBlockText(blocks: readonly HistoryPreviewContentBlock[]): string;
export declare function argumentSummary(argumentsText: string): string;
export declare function formattedArguments(argumentsText: string): string;
