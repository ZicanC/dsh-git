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
import { SessionSeq } from '@deepseek-ai/dsh-session';
export const MERGE_LINEAGE_EVENT = 'dsh-git/merge';
/** Build the seed-tail lineage event for a merged Session. */
export function mergeLineageEvent(sources, seq, time) {
    const lineage = {
        sources: sources.map((source, index) => ({
            sourceSessionId: source.sourceSessionId,
            sourceTurn: source.sourceTurn,
            sourceBoundarySeq: source.sourceBoundarySeq,
            targetTurn: index + 1,
            ...(source.sourceLabel === undefined ? {} : { sourceLabel: source.sourceLabel }),
        })),
    };
    return { type: MERGE_LINEAGE_EVENT, seq: SessionSeq(seq), time, data: lineage, ignorable: true };
}
/** Recover merge lineage from a Session log, or `undefined` for an ordinary Session. */
export function readMergeLineage(events) {
    for (const event of events) {
        if (event.type !== MERGE_LINEAGE_EVENT)
            continue;
        const data = event.data;
        if (!Array.isArray(data.sources))
            continue;
        return { sources: data.sources };
    }
    return undefined;
}
//# sourceMappingURL=merge-lineage.js.map