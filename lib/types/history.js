import { randomUUID } from 'node:crypto';
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session';
import { mergeLineageEvent } from "./merge-lineage.js";
import { readMergeLineage } from "./merge-lineage.js";
import { projectTurns } from "./project-history.js";
/**
 * Event types a selected turn carries into the merged seed.
 *
 * `system/message` and `developer/message` are deliberately absent. Both
 * describe the source Session's own composition — its rendered system prompt
 * and its tool roster — and a `developer/message` cites a `request/header` by
 * seq that may lie outside the copied turn. The seed opens with one system
 * message of its own instead (see {@link SeedHead}), and the child's first
 * request diffs its tools against the last copied `request/header`.
 */
const COPIED_EVENT_TYPES = new Set([
    'turn/start',
    'turn/end',
    'step/start',
    'step/end',
    'user/message',
    'assistant/attempt',
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
        return target === undefined ? [] : [SessionSeq(target)];
    });
    return mapped.length === 0 && event.sourceEventSeqs.length > 0 ? undefined : mapped;
}
/** Whether a system node carries a prompt, by the rule the loop applies to its own nodes. */
function hasPrompt(message) {
    const [block] = message.content;
    return message.content.length > 1
        || (block !== undefined && !(block.type === 'text' && block.text === ''));
}
/**
 * The system message in effect at one point of a source log: the last
 * surviving system node that carries a prompt, else the first system node.
 * @param throughSeq - inclusive seq the surface is folded through.
 * @returns the message, or undefined when the log has no system node there.
 */
export function effectiveSystemMessage(events, throughSeq) {
    const surface = [];
    for (const event of events) {
        if (event.seq > throughSeq)
            break;
        if (!('surfaceOp' in event) || event.surfaceOp === undefined)
            continue;
        const operation = event.surfaceOp;
        if (operation === 'append') {
            surface.push(event);
            continue;
        }
        const first = surface.findIndex(node => node.seq === operation.startSeq);
        const last = surface.findIndex(node => node.seq === operation.endSeq);
        if (first < 0 || last < first)
            continue;
        surface.splice(first, last - first + 1, event);
    }
    const nodes = surface.flatMap(event => event.type === 'system/message' ? [event.data.message] : []);
    return nodes.findLast(hasPrompt) ?? nodes[0];
}
/** A system node recording "no system prompt", for a source log that has none to copy. */
function emptySystemMessage() {
    return { id: randomUUID(), role: 'system', content: [], source: { kind: 'system-prompt' } };
}
function isSurfaceEvent(event) {
    return event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result';
}
/**
 * Copy one completed source turn into a detached target as a newly numbered real turn.
 * @param head - the seed's opening system message; written as the first
 *   surface node, inside the first step the copied turns open.
 */
export function appendHistoricalTurn(target, sourceEvents, targetTurn, head) {
    const seqMap = new Map();
    // Surface events met before the head could be written, in source order.
    const held = [];
    const placeHead = (step) => {
        if (head === undefined || head.placed)
            return;
        target.append('system/message', { turn: targetTurn, step, message: head.message }, { surfaceOp: 'append' });
        head.placed = true;
        for (const event of held.splice(0))
            copy(event);
    };
    for (const event of sourceEvents) {
        if (!COPIED_EVENT_TYPES.has(event.type))
            continue;
        if (head !== undefined && !head.placed) {
            // A system message belongs to a step. Logs from before the system prompt
            // was a surface event put the user message ahead of the first step, so
            // it waits for that step and follows the head into it — or into a step
            // opened just for the two when the turn never reached one.
            if (isSurfaceEvent(event)) {
                held.push(event);
                continue;
            }
            if (event.type === 'turn/end' && held.length > 0) {
                target.append('step/start', { turn: targetTurn, step: 1 });
                placeHead(1);
                target.append('step/end', { turn: targetTurn, step: 1 });
            }
        }
        copy(event);
        if (event.type === 'step/start')
            placeHead(event.data.step);
    }
    function copy(event) {
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
            case 'assistant/attempt':
                // Log-only: a failed or retried attempt keeps its stream without entering model history.
                appended = target.append('assistant/attempt', { ...event.data, turn: targetTurn });
                break;
            case 'assistant/message':
                // The message embeds its own stream, so it cites no source events.
                appended = target.append('assistant/message', { ...event.data, turn: targetTurn }, { surfaceOp: 'append' });
                break;
            case 'tool/call':
                appended = target.append('tool/call', { ...event.data, turn: targetTurn });
                break;
            case 'tool/result':
                // Replacement copies point into a source-only surface. Import the durable append-origin result only.
                if (event.surfaceOp !== 'append')
                    return;
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
                return;
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
    // Validate identity and history membership before creating any target state.
    // Copied prefixes and composed seeds use exact log provenance, never text equality.
    const identities = new Map();
    const resolve = async (source, visiting = new Set()) => {
        const key = JSON.stringify([source.sourceSessionId, source.sourceTurn, source.sourceBoundarySeq]);
        if (visiting.has(key))
            throw new Error('Cyclic Session provenance');
        const cached = identities.get(key);
        if (cached !== undefined)
            return cached;
        const next = new Set(visiting).add(key);
        const pending = (async () => {
            const snapshot = await readSession(SessionId(source.sourceSessionId));
            sourceTurnEvents(snapshot, source);
            const merged = readMergeLineage(snapshot.events)?.sources.find(item => item.targetTurn === source.sourceTurn);
            if (merged !== undefined)
                return resolve(merged, next);
            if (snapshot.session.parentSession !== undefined
                && source.sourceBoundarySeq < (snapshot.inheritedEventCount ?? 0)) {
                return resolve({ ...source, sourceSessionId: snapshot.session.parentSession }, next);
            }
            return key;
        })();
        identities.set(key, pending);
        return pending;
    };
    const selected = new Set();
    for (const source of sources) {
        const identity = await resolve(source);
        if (selected.has(identity))
            throw new Error('Duplicate Context PA identity');
        selected.add(identity);
        if (source.viaSessionId === undefined || source.viaSessionId === source.sourceSessionId)
            continue;
        const via = await readSession(SessionId(source.viaSessionId));
        let matches = 0;
        for (const turn of projectTurns(via)) {
            const candidate = await resolve({ sourceSessionId: source.viaSessionId,
                sourceTurn: turn.turn, sourceBoundarySeq: turn.boundarySeq });
            if (candidate === identity)
                matches += 1;
        }
        if (matches !== 1)
            throw new Error('Context source is not a unique Session history member');
    }
    const target = Session.create(SessionId(targetSessionId));
    // The child inherits the preset of the last source, so that source's system
    // prompt is the one its first request is most likely to render again — in
    // which case the loop finds it already in place and writes nothing.
    const last = sources.at(-1);
    const head = last === undefined ? undefined : {
        message: effectiveSystemMessage((await readSession(SessionId(last.sourceSessionId))).events, last.sourceBoundarySeq) ?? emptySystemMessage(),
        placed: false,
    };
    for (const [index, source] of sources.entries()) {
        const snapshot = await readSession(SessionId(source.sourceSessionId));
        appendHistoricalTurn(target, sourceTurnEvents(snapshot, source), index + 1, head);
    }
    const events = [...target.snapshotEvents()];
    events.push(mergeLineageEvent(sources, events.length, Date.now()));
    return events;
}
//# sourceMappingURL=history.js.map