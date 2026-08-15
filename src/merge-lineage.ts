/**
 * Durable provenance of one merge branch, written into the merged Session's seed.
 *
 * The graph ledger in `./graph-domain.ts` is the working store, but it is a
 * separate medium from the session log: delete the storage root and the merge
 * edges are gone. This event travels inside the log itself, so a merged Session
 * always carries the coordinates it was assembled from.
 *
 * It must be marked `ignorable`. `session-persistence` refuses to interpret a
 * log holding an event type outside `KNOWN_SESSION_EVENT_TYPES` unless the
 * writer set that flag, and a plugin cannot extend that build-time set — an
 * unmarked event here would make every merged Session unloadable. `ignorable`
 * cannot be passed through `Session.append`, so the event is constructed
 * directly and placed in the seed, which is the only write path that accepts it.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { HistoryTurnSource } from './protocol.ts'

/** Where one turn of a merged Session was copied from. */
export interface MergeLineageSource {
  readonly sourceSessionId: string
  readonly sourceTurn: number
  readonly sourceBoundarySeq: number
  /** Turn number this source occupies in the merged Session. */
  readonly targetTurn: number
}

/**
 * Complete lineage of one merged Session, in Context Tray order.
 *
 * Coordinates are Host-side (`sessionId` + turn), never browser node ids: the
 * ledger's ids are local to one browser profile, while these resolve against
 * the canonical logs from any client.
 */
export interface MergeLineage {
  readonly sources: readonly MergeLineageSource[]
}

export const MERGE_LINEAGE_EVENT = 'dsh-git/merge'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** dsh-git merge provenance; log-only, ignorable, written once into the seed. */
    'dsh-git/merge': MergeLineage
  }
}

/** Build the seed-tail lineage event for a merged Session. */
export function mergeLineageEvent(
  sources: readonly HistoryTurnSource[],
  seq: number,
  time: number,
): SessionEvent<'dsh-git/merge'> {
  const lineage: MergeLineage = {
    sources: sources.map((source, index) => ({
      sourceSessionId: source.sourceSessionId,
      sourceTurn: source.sourceTurn,
      sourceBoundarySeq: source.sourceBoundarySeq,
      targetTurn: index + 1,
    })),
  }
  return { type: MERGE_LINEAGE_EVENT, seq, time, data: lineage, ignorable: true }
}

/** Recover merge lineage from a Session log, or `undefined` for an ordinary Session. */
export function readMergeLineage(events: readonly SessionEvent[]): MergeLineage | undefined {
  for (const event of events) {
    if (event.type !== MERGE_LINEAGE_EVENT) continue
    const data = event.data as Partial<MergeLineage>
    if (!Array.isArray(data.sources)) continue
    return { sources: data.sources }
  }
  return undefined
}
