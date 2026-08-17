const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
/**
 * Synthetic seq floor for records with no logged event of their own (the
 * partial assistant and running tool calls). Real seqs stay far below it, so
 * the tail keeps its produced-last position.
 */
const LIVE_SEQ_BASE = Number.MAX_SAFE_INTEGER - 4096;
function record(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    return value;
}
function text(value) {
    return typeof value === 'string' ? value : '';
}
function attachment(value) {
    const source = record(value);
    if (source === null)
        return null;
    const mediaType = text(source.mediaType);
    if (!IMAGE_MEDIA_TYPES.has(mediaType))
        return null;
    const name = source.name;
    return {
        attachmentId: String(source.attachmentId),
        mediaType: mediaType,
        bytes: typeof source.bytes === 'number' ? source.bytes : 0,
        width: typeof source.width === 'number' ? source.width : 0,
        height: typeof source.height === 'number' ? source.height : 0,
        ...(typeof name === 'string' ? { name } : {}),
    };
}
function opaque(block) {
    const source = record(block);
    return {
        type: 'other',
        originalType: source === null ? 'unknown' : text(source.type) || 'unknown',
        value: block,
    };
}
/** Project one core content block; unknown shapes degrade to the JSON card. */
function contentBlock(block) {
    const source = record(block);
    if (source === null)
        return opaque(block);
    switch (source.type) {
        case 'text':
            return { type: 'text', text: text(source.text) };
        case 'reasoning':
            return { type: 'reasoning', text: text(source.text) };
        case 'image': {
            const image = attachment(source.attachment);
            return image === null ? opaque(block) : { type: 'image', attachment: image };
        }
        case 'tool-call':
            return {
                type: 'tool-call',
                callId: String(source.id),
                name: text(source.name),
                arguments: text(source.arguments),
            };
        case 'tool-result':
            return {
                type: 'tool-result',
                callId: String(source.toolCallId),
                content: (Array.isArray(source.content) ? source.content : []).map(contentBlock),
                isError: source.isError === true,
            };
        default:
            return opaque(block);
    }
}
function contentBlocks(content) {
    return content.map(contentBlock);
}
/** Project the UI-classified assistant blocks published for a finalized or partial message. */
function assistantBlocks(blocks) {
    return blocks.map((block) => {
        switch (block.kind) {
            case 'text':
                return { type: 'text', text: block.text };
            case 'reasoning':
                return { type: 'reasoning', text: block.text };
            case 'image': {
                const image = attachment(block.attachment);
                return image === null ? opaque(block.attachment) : { type: 'image', attachment: image };
            }
            case 'tool-call':
                return { type: 'tool-call', callId: block.callId, name: block.name, arguments: block.argsRaw };
            case 'other':
                return opaque(block.block);
        }
    });
}
/** Project one finalized conversation node into preview records, in flow order. */
function nodeRecords(node) {
    switch (node.kind) {
        case 'user':
        case 'steering':
        case 'context':
            return [{
                    kind: 'user',
                    seq: node.seq,
                    messageId: `live-message:${node.seq}`,
                    content: contentBlocks(node.content),
                    source: node.source,
                }];
        case 'assistant':
            return [{
                    kind: 'assistant',
                    seq: node.seq,
                    step: node.step,
                    messageId: node.messageId === undefined ? `live-assistant:${node.seq}` : String(node.messageId),
                    blocks: assistantBlocks(node.blocks),
                    provenance: node.provenance ?? { provider: '', model: '' },
                }];
        case 'tool-result': {
            const result = {
                kind: 'tool-result',
                seq: node.seq,
                step: 0,
                callId: node.callId,
                content: contentBlocks(node.content),
                isError: node.isError,
                ...(node.error === undefined ? {} : { error: node.error }),
            };
            return node.call === null
                ? [result]
                : [{
                        kind: 'tool-call',
                        seq: node.seq,
                        step: 0,
                        callId: node.callId,
                        name: node.call.name,
                        arguments: node.call.argsRaw,
                    }, result];
        }
        case 'turn-error':
            return [{
                    kind: 'turn-status',
                    seq: node.seq,
                    status: node.code ?? 'error',
                    details: { message: node.message },
                }];
        case 'turn-max-tokens':
            return [{ kind: 'turn-status', seq: node.seq, status: 'max-tokens', details: {} }];
        default:
            return [{
                    kind: 'event',
                    seq: node.seq,
                    eventType: node.kind,
                    data: node,
                }];
    }
}
/**
 * Project every open turn the graph does not own yet.
 *
 * Open is the load-bearing half of that condition: a closed turn is a PA the
 * moment the view syncs it, so projecting closed turns would duplicate the
 * whole loaded window on the first render after a mount, before that sync
 * lands. Only a turn that is still producing output has no PA to defer to.
 *
 * @param source - the live conversation slice of the current Session.
 * @param afterTurn - highest turn number already registered as a graph PA.
 * @returns ordered live sections; empty whenever nothing is running.
 */
export function projectLiveTurns(source, afterTurn) {
    const views = [];
    for (const turn of source.chat.timeline.turnOrder) {
        if (turn <= afterTurn)
            continue;
        const location = source.chat.timeline.turns.get(turn);
        const start = location?.start;
        if (location === undefined || start === undefined || location.status !== 'open')
            continue;
        const end = location.end;
        const records = [];
        for (const node of source.nodes) {
            if (node.seq <= start.seq)
                continue;
            if (end !== undefined && node.seq > end.seq)
                continue;
            records.push(...nodeRecords(node));
        }
        // A call is only "running" until its result lands, so this never doubles
        // the tool row a settled `tool-result` node already contributes.
        let synthetic = LIVE_SEQ_BASE;
        for (const call of source.runningCalls) {
            if (call.turn !== turn)
                continue;
            synthetic += 1;
            records.push({
                kind: 'tool-call',
                seq: synthetic,
                step: call.step,
                callId: call.callId,
                name: call.name,
                arguments: call.argsRaw,
            });
        }
        const partial = source.partial;
        if (partial !== null && partial.turn === turn && partial.blocks.length > 0) {
            records.push({
                kind: 'assistant',
                seq: LIVE_SEQ_BASE,
                step: partial.step,
                messageId: `live-partial:${turn}`,
                blocks: assistantBlocks(partial.blocks),
                provenance: { provider: '', model: '' },
            });
        }
        views.push({ key: `live-turn:${turn}`, turn, records });
    }
    return views;
}
//# sourceMappingURL=live-turn.js.map