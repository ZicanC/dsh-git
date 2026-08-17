/**
 * Per-PA record cache for Chat History.
 *
 * A completed turn is immutable: its source Session, turn number, and closing
 * boundary seq address exactly one frozen record list. Adding, removing, or
 * reordering a PA therefore never invalidates the other PAs, so the panel
 * fetches only the sources it has never seen and assembles the rest locally
 * instead of re-projecting the whole merge on the Host for every edit.
 */
import type {
  HistoryPreviewRecord, HistoryPreviewResponse, HistoryTurnSource,
} from '../protocol.ts'

/** Soft ceiling; well above one merge's limit, and bounded for long sessions. */
const MAX_CACHED_TURNS = 1024

const NO_RECORDS: readonly HistoryPreviewRecord[] = []

/** Immutable identity of one source turn. */
export function previewSourceKey(source: HistoryTurnSource): string {
  return `${source.sourceSessionId}:${source.sourceTurn}:${source.sourceBoundarySeq}`
}

/** Insertion-ordered store of projected turns, keyed by source identity. */
export class HistoryPreviewCache {
  private readonly records = new Map<string, readonly HistoryPreviewRecord[]>()

  /** @param source - one selected turn. @returns whether its records are known. */
  has(source: HistoryTurnSource): boolean {
    return this.records.has(previewSourceKey(source))
  }

  /** @param source - one selected turn. @returns its records, or null when unknown. */
  get(source: HistoryTurnSource): readonly HistoryPreviewRecord[] | null {
    return this.records.get(previewSourceKey(source)) ?? null
  }

  /** Store every turn of one Host response, evicting the oldest entries past the ceiling. */
  absorb(response: HistoryPreviewResponse): void {
    for (const turn of response.turns) {
      const key = previewSourceKey(turn.source)
      // Re-insert so a re-read refreshes recency under the ceiling.
      this.records.delete(key)
      this.records.set(key, turn.records)
    }
    for (const key of this.records.keys()) {
      if (this.records.size <= MAX_CACHED_TURNS) break
      this.records.delete(key)
    }
  }

  /** @param sources - the selected order. @returns sources with no cached records. */
  missing(sources: readonly HistoryTurnSource[]): readonly HistoryTurnSource[] {
    const seen = new Set<string>()
    return sources.filter((source) => {
      const key = previewSourceKey(source)
      if (this.records.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /**
   * Assemble the selected order into one response shaped exactly like the
   * Host's, so a partially cached selection still renders its known PAs.
   *
   * @param sources - the selected order.
   * @returns the response; not-yet-fetched turns carry an empty record list.
   */
  assemble(sources: readonly HistoryTurnSource[]): HistoryPreviewResponse {
    return {
      turns: sources.map((source, index) => ({
        source,
        targetTurn: index + 1,
        records: this.records.get(previewSourceKey(source)) ?? NO_RECORDS,
      })),
    }
  }
}
