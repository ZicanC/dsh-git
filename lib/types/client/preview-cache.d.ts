/**
 * Per-PA record cache for Chat History.
 *
 * A completed turn is immutable: its source Session, turn number, and closing
 * boundary seq address exactly one frozen record list. Adding, removing, or
 * reordering a PA therefore never invalidates the other PAs, so the panel
 * fetches only the sources it has never seen and assembles the rest locally
 * instead of re-projecting the whole merge on the Host for every edit.
 */
import type { HistoryPreviewRecord, HistoryPreviewResponse, HistoryTurnSource } from '../protocol.ts';
/** Immutable identity of one source turn. */
export declare function previewSourceKey(source: HistoryTurnSource): string;
/** Insertion-ordered store of projected turns, keyed by source identity. */
export declare class HistoryPreviewCache {
    private readonly records;
    /** @param source - one selected turn. @returns whether its records are known. */
    has(source: HistoryTurnSource): boolean;
    /** @param source - one selected turn. @returns its records, or null when unknown. */
    get(source: HistoryTurnSource): readonly HistoryPreviewRecord[] | null;
    /** Store every turn of one Host response, evicting the oldest entries past the ceiling. */
    absorb(response: HistoryPreviewResponse): void;
    /** @param sources - the selected order. @returns sources with no cached records. */
    missing(sources: readonly HistoryTurnSource[]): readonly HistoryTurnSource[];
    /**
     * Assemble the selected order into one response shaped exactly like the
     * Host's, so a partially cached selection still renders its known PAs.
     *
     * @param sources - the selected order.
     * @returns the response; not-yet-fetched turns carry an empty record list.
     */
    assemble(sources: readonly HistoryTurnSource[]): HistoryPreviewResponse;
}
