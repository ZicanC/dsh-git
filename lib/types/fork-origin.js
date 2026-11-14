import { readMergeLineage } from "./merge-lineage.js";
function inheritedCount(snapshot) {
    return snapshot.inheritedEventCount ?? 0;
}
function sameEvent(left, right) {
    if (left === undefined || right === undefined)
        return false;
    return left.type === right.type && left.seq === right.seq && left.time === right.time
        && JSON.stringify(left) === JSON.stringify(right);
}
/** Whether `candidate` holds, event for event, the whole prefix `fork` inherited. */
function holdsInheritedPrefix(fork, candidate) {
    const count = inheritedCount(fork);
    if (candidate.events.length < count)
        return false;
    // The tip differs for almost every unrelated log, so it is compared first.
    for (let index = count - 1; index >= 0; index -= 1) {
        if (!sameEvent(fork.events[index], candidate.events[index]))
            return false;
    }
    return true;
}
/**
 * The Session a fork inherited its prefix from.
 *
 * A parent recorded in the header (Harness before 0.2.1-rc.3, and every
 * Session this plugin composes) is returned as it is. Otherwise the origin is
 * the candidate that holds the inherited prefix verbatim and wrote its last
 * event itself: a sibling fork of the same prefix inherited that event too, so
 * it is not where the history comes from.
 * @param candidates - Sessions the origin may be among; the fork itself is skipped.
 * @returns the origin's Session id, or undefined when the Session is not a
 *   fork or its origin is not among the candidates.
 */
export function forkOrigin(fork, candidates) {
    if (fork.session.parentSession !== undefined)
        return fork.session.parentSession;
    const count = inheritedCount(fork);
    // A composed seed renumbers what it copies; its provenance is its merge lineage.
    if (count === 0 || readMergeLineage(fork.events) !== undefined)
        return undefined;
    let origin;
    for (const candidate of candidates) {
        if (candidate.session.id === fork.session.id || inheritedCount(candidate) >= count)
            continue;
        if (!holdsInheritedPrefix(fork, candidate))
            continue;
        if (origin === undefined
            || candidate.session.createdAt < origin.session.createdAt
            || (candidate.session.createdAt === origin.session.createdAt
                && String(candidate.session.id) < String(origin.session.id)))
            origin = candidate;
    }
    return origin === undefined ? undefined : String(origin.session.id);
}
//# sourceMappingURL=fork-origin.js.map