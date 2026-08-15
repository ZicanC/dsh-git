export const MERGE_LINEAGE_EVENT = 'dsh-git/merge';
/** Build the seed-tail lineage event for a merged Session. */
export function mergeLineageEvent(sources, seq, time) {
    const lineage = {
        sources: sources.map((source, index) => ({
            sourceSessionId: source.sourceSessionId,
            sourceTurn: source.sourceTurn,
            sourceBoundarySeq: source.sourceBoundarySeq,
            targetTurn: index + 1,
        })),
    };
    return { type: MERGE_LINEAGE_EVENT, seq, time, data: lineage, ignorable: true };
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