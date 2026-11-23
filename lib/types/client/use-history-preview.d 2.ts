import { type HistoryPreviewResponse, type HistoryTurnSource } from '../protocol.ts';
import { type Locale } from './i18n.ts';
import type { TurnNodeId } from './types.ts';
/** One selected PA and where the Host reads it from. */
export interface PreviewEntry {
    readonly nodeId: TurnNodeId;
    readonly source: HistoryTurnSource;
}
/** Chat History for the current selection, as far as it has been read. */
export interface HistoryPreview {
    /** The selection in order; a PA not read yet carries no records. Null for an empty or oversized selection. */
    readonly response: HistoryPreviewResponse | null;
    /** Selected PAs whose records have not arrived yet. */
    readonly pendingNodeIds: ReadonlySet<TurnNodeId>;
    readonly loading: boolean;
    readonly error: string | null;
}
/**
 * Keep Chat History in step with the selection.
 *
 * A completed turn is immutable, so its records are cached for the lifetime
 * of the view. Only PAs this view has never read are requested, and a request
 * in flight is never cancelled by a later selection edit: its records stay
 * valid for whatever selection is current when they land. Removing a PA is
 * therefore pure local work, and re-adding one costs no Host round trip.
 * @param entries - the selection in order; keep its identity stable between
 *   renders that do not change it.
 */
export declare function useHistoryPreview(entries: readonly PreviewEntry[], load: (sources: readonly HistoryTurnSource[], signal: AbortSignal) => Promise<HistoryPreviewResponse>, locale: Locale): HistoryPreview;
