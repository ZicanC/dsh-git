import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { mergeLineageEvent } from "./merge-lineage.js";
const COPIED_EVENT_TYPES = new Set([
    'turn/start',
    'turn/end',
    'step/start',
    'step/end',
    'user/message',
    'assistant/chunk',
    'assistant/message',
    'tool/call',
    'tool/result',
    'request/header',
    'request/context',
]);
function sourceTurnEvents(snapshot, source) {
    const end = snapshot.events[source.sourceBoundarySeq];
    if (end?.type !== 'turn/end' || end.data.turn !== source.sourceTurn) {
        throw new Error(`source session "${source.sourceSessionId}" seq ${source.sourceBoundarySeq} is not turn ${source.sourceTurn}'s end`);
    }
    let startIndex = -1;
    for (let index = source.sourceBoundarySeq; index >= 0; index -= 1) {
        const event = snapshot.events[index];
        if (event?.type === 'turn/start' && event.data.turn === source.sourceTurn) {
            startIndex = index;
            break;
        }
    }
    if (startIndex < 0) {
        throw new Error(`source session "${source.sourceSessionId}" has no start for turn ${source.sourceTurn}`);
    }
    return snapshot.events.slice(startIndex, source.sourceBoundarySeq + 1);
}
function mappedSources(event, seqMap) {
    if (!('sourceEventSeqs' in event) || event.sourceEventSeqs === undefined)
        return undefined;
    const mapped = event.sourceEventSeqs.flatMap(seq => {
        const target = seqMap.get(seq);
        return target === undefined ? [] : [target];
    });
    return mapped.length === 0 && event.sourceEventSeqs.length > 0 ? undefined : mapped;
}
/** Copy one completed source turn into a detached target as a newly numbered real turn. */
export function appendHistoricalTurn(target, sourceEvents, targetTurn) {
    const seqMap = new Map();
    for (const event of sourceEvents) {
        if (!COPIED_EVENT_TYPES.has(event.type))
            continue;
        const sourceEventSeqs = mappedSources(event, seqMap);
        let appended;
        switch (event.type) {
            case 'turn/start':
                appended = target.append('turn/start', { turn: targetTurn });
                break;
            case 'turn/end':
                appended = target.append('turn/end', { turn: targetTurn, reason: event.data.reason });
                break;
            case 'step/start':
                appended = target.append('step/start', { ...event.data, turn: targetTurn });
                break;
            case 'step/end':
                appended = target.append('step/end', { ...event.data, turn: targetTurn });
                break;
            case 'assistant/chunk':
                appended = target.append('assistant/chunk', { ...event.data, turn: targetTurn });
                break;
            case 'assistant/message':
                appended = target.append('assistant/message', { ...event.data, turn: targetTurn }, { surfaceOp: 'append', ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }) });
                break;
            case 'tool/call':
                appended = target.append('tool/call', { ...event.data, turn: targetTurn });
                break;
            case 'tool/result':
                // Replacement copies point into a source-only surface. Import the durable append-origin result only.
                if (event.surfaceOp !== 'append')
                    continue;
                appended = target.append('tool/result', { ...event.data, turn: targetTurn }, { surfaceOp: 'append', ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }) });
                break;
            case 'user/message':
                // A merged session owns an independent surface, so every selected user message is appended.
                appended = target.append('user/message', event.data, { surfaceOp: 'append', ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }) });
                break;
            case 'request/header':
                appended = target.append('request/header', event.data);
                break;
            case 'request/context':
                appended = target.append('request/context', event.data);
                break;
            default:
                continue;
        }
        seqMap.set(event.seq, appended.seq);
    }
}
/**
 * Read selected turns in tray order and produce a contiguous, balanced Agent seed.
 *
 * The seed closes with the log-only `dsh-git/merge` lineage event, appended
 * directly rather than through `Session.append` because only a seed event may
 * carry `ignorable` (see `./merge-lineage.ts`).
 */
export async function buildMergedSessionSeed(targetSessionId, sources, readSession) {
    const target = Session.create(SessionId(targetSessionId));
    for (const [index, source] of sources.entries()) {
        const snapshot = await readSession(SessionId(source.sourceSessionId));
        appendHistoricalTurn(target, sourceTurnEvents(snapshot, source), index + 1);
    }
    const events = [...target.events];
    events.push(mergeLineageEvent(sources, events.length, Date.now()));
    return events;
}
//# sourceMappingURL=history.js.map