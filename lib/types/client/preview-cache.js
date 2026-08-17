/** Soft ceiling; well above one merge's limit, and bounded for long sessions. */
const MAX_CACHED_TURNS = 1024;
const NO_RECORDS = [];
/** Immutable identity of one source turn. */
export function previewSourceKey(source) {
    return `${source.sourceSessionId}:${source.sourceTurn}:${source.sourceBoundarySeq}`;
}
/** Insertion-ordered store of projected turns, keyed by source identity. */
export class HistoryPreviewCache {
    records = new Map();
    /** @param source - one selected turn. @returns whether its records are known. */
    has(source) {
        return this.records.has(previewSourceKey(source));
    }
    /** @param source - one selected turn. @returns its records, or null when unknown. */
    get(source) {
        return this.records.get(previewSourceKey(source)) ?? null;
    }
    /** Store every turn of one Host response, evicting the oldest entries past the ceiling. */
    absorb(response) {
        for (const turn of response.turns) {
            const key = previewSourceKey(turn.source);
            // Re-insert so a re-read refreshes recency under the ceiling.
            this.records.delete(key);
            this.records.set(key, turn.records);
        }
        for (const key of this.records.keys()) {
            if (this.records.size <= MAX_CACHED_TURNS)
                break;
            this.records.delete(key);
        }
    }
    /** @param sources - the selected order. @returns sources with no cached records. */
    missing(sources) {
        const seen = new Set();
        return sources.filter((source) => {
            const key = previewSourceKey(source);
            if (this.records.has(key) || seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
    /**
     * Assemble the selected order into one response shaped exactly like the
     * Host's, so a partially cached selection still renders its known PAs.
     *
     * @param sources - the selected order.
     * @returns the response; not-yet-fetched turns carry an empty record list.
     */
    assemble(sources) {
        return {
            turns: sources.map((source, index) => ({
                source,
                targetTurn: index + 1,
                records: this.records.get(previewSourceKey(source)) ?? NO_RECORDS,
            })),
        };
    }
}
//# sourceMappingURL=preview-cache.js.map