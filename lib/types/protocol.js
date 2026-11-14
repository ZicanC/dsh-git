/** Generic Connection channel and endpoint used by the project graph reader. */
export const PROJECT_GRAPH_RPC_CHANNEL = '/dsh-git';
export const PROJECT_GRAPH_RPC_ENDPOINT = 'workspace/graph';
export const HISTORY_PREVIEW_RPC_ENDPOINT = 'history/preview';
export const CREATE_MERGED_SESSION_RPC_ENDPOINT = 'session/create-merged';
export const CREATE_ANCHORED_SESSION_RPC_ENDPOINT = 'session/create-anchored';
export const CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT = 'workspace/create-anchor';
export const CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT = 'workspace/cancel-anchor';
export const ANCHORED_SESSION_PREFIX = 'dsh-git-anchor-';
export function isAnchoredSessionId(value) {
    return value.startsWith(ANCHORED_SESSION_PREFIX);
}
/** Practical upper bound for one merged context while retaining full-session defaults. */
export const MAX_MERGED_HISTORY_TURNS = 512;
/** Endpoints backing the Host-owned graph ledger. */
export const GRAPH_READ_ENDPOINT = 'graph/read';
export const GRAPH_WRITE_ENDPOINT = 'graph/write';
function object(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}
function exactKeys(value, allowed, label) {
    const allowedKeys = new Set(allowed);
    const unexpected = Object.keys(value).find(key => !allowedKeys.has(key));
    if (unexpected !== undefined)
        throw new Error(`${label} contains unexpected field "${unexpected}"`);
}
function nonBlank(value, label) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new Error(`${label} must be a non-blank string`);
    return value;
}
function nonNegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`${label} must be a non-negative integer`);
    return value;
}
function positiveInteger(value, label) {
    const parsed = nonNegativeInteger(value, label);
    if (parsed < 1)
        throw new Error(`${label} must be positive`);
    return parsed;
}
function boolean(value, label) {
    if (typeof value !== 'boolean')
        throw new Error(`${label} must be boolean`);
    return value;
}
function string(value, label) {
    if (typeof value !== 'string')
        throw new Error(`${label} must be a string`);
    return value;
}
function jsonValue(value, label) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error(`${label} must contain only finite JSON numbers`);
        return value;
    }
    if (Array.isArray(value))
        return value.map((item, index) => jsonValue(item, `${label}[${index}]`));
    if (typeof value !== 'object')
        throw new Error(`${label} must be JSON-serializable`);
    if (Object.getOwnPropertySymbols(value).length > 0)
        throw new Error(`${label} must not contain symbol keys`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${label}.${key}`)]));
}
function decodeHistoryTurnSource(value, label) {
    const source = object(value, label);
    return {
        ...(source.viaSessionId === undefined ? {} : { viaSessionId: nonBlank(source.viaSessionId, `${label} viaSessionId`) }),
        sourceSessionId: nonBlank(source.sourceSessionId, `${label} sourceSessionId`),
        sourceTurn: positiveInteger(source.sourceTurn, `${label} sourceTurn`),
        sourceBoundarySeq: nonNegativeInteger(source.sourceBoundarySeq, `${label} sourceBoundarySeq`),
    };
}
function decodeHistoryTurnSources(value, label) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MERGED_HISTORY_TURNS) {
        throw new Error(`${label} requires 1 to ${MAX_MERGED_HISTORY_TURNS} source turns`);
    }
    return value.map((source, index) => decodeHistoryTurnSource(source, `${label} source ${index + 1}`));
}
function decodeImageAttachment(value, label) {
    const attachment = object(value, label);
    const mediaType = attachment.mediaType;
    if (mediaType !== 'image/png' && mediaType !== 'image/jpeg'
        && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
        throw new Error(`${label} mediaType is invalid`);
    }
    return {
        attachmentId: nonBlank(attachment.attachmentId, `${label} attachmentId`),
        mediaType,
        bytes: nonNegativeInteger(attachment.bytes, `${label} bytes`),
        width: positiveInteger(attachment.width, `${label} width`),
        height: positiveInteger(attachment.height, `${label} height`),
        ...(attachment.name === undefined ? {} : { name: string(attachment.name, `${label} name`) }),
    };
}
function decodeHistoryPreviewBlock(value, label) {
    const block = object(value, label);
    const type = nonBlank(block.type, `${label} type`);
    switch (type) {
        case 'text':
        case 'reasoning':
            if (typeof block.text !== 'string')
                throw new Error(`${label} text must be a string`);
            return { type, text: block.text };
        case 'image':
            return { type, attachment: decodeImageAttachment(block.attachment, `${label} attachment`) };
        case 'tool-call':
            if (typeof block.arguments !== 'string')
                throw new Error(`${label} arguments must be a string`);
            return {
                type,
                callId: nonBlank(block.callId, `${label} callId`),
                name: nonBlank(block.name, `${label} name`),
                arguments: block.arguments,
            };
        case 'tool-result': {
            if (!Array.isArray(block.content))
                throw new Error(`${label} content must be an array`);
            return {
                type,
                callId: nonBlank(block.callId, `${label} callId`),
                content: block.content.map((item, index) => decodeHistoryPreviewBlock(item, `${label} content ${index + 1}`)),
                isError: boolean(block.isError, `${label} isError`),
            };
        }
        case 'other':
            return {
                type,
                originalType: nonBlank(block.originalType, `${label} originalType`),
                value: jsonValue(block.value, `${label} value`),
            };
        default:
            throw new Error(`${label} has unknown type "${type}"`);
    }
}
function decodeHistoryPreviewBlocks(value, label) {
    if (!Array.isArray(value))
        throw new Error(`${label} must be an array`);
    return value.map((block, index) => decodeHistoryPreviewBlock(block, `${label} block ${index + 1}`));
}
function decodeHistoryPreviewRecord(value, label) {
    const record = object(value, label);
    const kind = nonBlank(record.kind, `${label} kind`);
    const seq = nonNegativeInteger(record.seq, `${label} seq`);
    switch (kind) {
        case 'user':
            return {
                kind,
                seq,
                messageId: nonBlank(record.messageId, `${label} messageId`),
                content: decodeHistoryPreviewBlocks(record.content, `${label} content`),
                source: jsonValue(record.source, `${label} source`),
            };
        case 'assistant': {
            const provenance = object(record.provenance, `${label} provenance`);
            return {
                kind,
                seq,
                step: nonNegativeInteger(record.step, `${label} step`),
                messageId: nonBlank(record.messageId, `${label} messageId`),
                blocks: decodeHistoryPreviewBlocks(record.blocks, `${label} blocks`),
                provenance: {
                    provider: nonBlank(provenance.provider, `${label} provenance provider`),
                    model: nonBlank(provenance.model, `${label} provenance model`),
                },
                ...(record.usage === undefined ? {} : { usage: jsonValue(record.usage, `${label} usage`) }),
            };
        }
        case 'tool-call':
            if (typeof record.arguments !== 'string')
                throw new Error(`${label} arguments must be a string`);
            return {
                kind,
                seq,
                step: nonNegativeInteger(record.step, `${label} step`),
                callId: nonBlank(record.callId, `${label} callId`),
                name: nonBlank(record.name, `${label} name`),
                arguments: record.arguments,
            };
        case 'tool-result': {
            const error = record.error === undefined ? undefined : object(record.error, `${label} error`);
            return {
                kind,
                seq,
                step: nonNegativeInteger(record.step, `${label} step`),
                callId: nonBlank(record.callId, `${label} callId`),
                content: decodeHistoryPreviewBlocks(record.content, `${label} content`),
                isError: boolean(record.isError, `${label} isError`),
                ...(error === undefined ? {} : { error: {
                        name: nonBlank(error.name, `${label} error name`),
                        code: nonBlank(error.code, `${label} error code`),
                    } }),
                ...(record.meta === undefined ? {} : { meta: jsonValue(record.meta, `${label} meta`) }),
            };
        }
        case 'request':
            if (record.requestKind !== 'header' && record.requestKind !== 'context') {
                throw new Error(`${label} requestKind is invalid`);
            }
            return { kind, seq, requestKind: record.requestKind, data: jsonValue(record.data, `${label} data`) };
        case 'turn-status':
            return {
                kind,
                seq,
                status: nonBlank(record.status, `${label} status`),
                details: jsonValue(record.details, `${label} details`),
            };
        case 'event':
            return {
                kind,
                seq,
                eventType: nonBlank(record.eventType, `${label} eventType`),
                data: jsonValue(record.data, `${label} data`),
            };
        default:
            throw new Error(`${label} has unknown kind "${kind}"`);
    }
}
/** Strictly validate an untrusted ordered history-preview request. */
export function decodeHistoryPreviewRequest(value) {
    const candidate = object(value, 'dsh-git history preview request');
    return { sources: decodeHistoryTurnSources(candidate.sources, 'dsh-git history preview request') };
}
/** Strictly validate the full Host history projection received across Connection. */
export function decodeHistoryPreviewResponse(value) {
    const candidate = object(value, 'dsh-git history preview response');
    if (!Array.isArray(candidate.turns)
        || candidate.turns.length === 0
        || candidate.turns.length > MAX_MERGED_HISTORY_TURNS) {
        throw new Error(`dsh-git history preview response requires 1 to ${MAX_MERGED_HISTORY_TURNS} turns`);
    }
    const turns = candidate.turns.map((rawTurn, index) => {
        const label = `dsh-git history preview response turn ${index + 1}`;
        const turn = object(rawTurn, label);
        const targetTurn = positiveInteger(turn.targetTurn, `${label} targetTurn`);
        if (targetTurn !== index + 1)
            throw new Error(`${label} targetTurn must preserve source order`);
        if (!Array.isArray(turn.records))
            throw new Error(`${label} records must be an array`);
        const records = turn.records.map((record, recordIndex) => decodeHistoryPreviewRecord(record, `${label} record ${recordIndex + 1}`));
        for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
            if (records[recordIndex].seq <= records[recordIndex - 1].seq) {
                throw new Error(`${label} records must have ascending seq values`);
            }
        }
        return {
            source: decodeHistoryTurnSource(turn.source, `${label} source`),
            targetTurn,
            records,
        };
    });
    return { turns };
}
/** Strictly validate the trusted RPC request before creating any Host state. */
export function decodeCreateMergedSessionRequest(value) {
    const label = 'dsh-git create merged session request';
    const candidate = object(value, label);
    exactKeys(candidate, ['targetSessionId', 'sources'], label);
    const sources = decodeHistoryTurnSources(candidate.sources, label);
    const rawSources = candidate.sources;
    rawSources.forEach((source, index) => {
        const sourceLabel = `${label} source ${index + 1}`;
        exactKeys(object(source, sourceLabel), [
            'sourceSessionId', 'sourceTurn', 'sourceBoundarySeq', 'viaSessionId',
        ], sourceLabel);
    });
    return {
        targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`),
        sources,
    };
}
/** Strictly validate the Host acknowledgement received across Connection. */
export function decodeCreateMergedSessionResponse(value) {
    const label = 'dsh-git create merged session response';
    const candidate = object(value, label);
    exactKeys(candidate, ['targetSessionId'], label);
    return { targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`) };
}
/** Strictly validate an anchored-child creation request. */
export function decodeCreateAnchoredSessionRequest(value) {
    const label = 'dsh-git create anchored session request';
    const candidate = object(value, label);
    exactKeys(candidate, ['targetSessionId', 'workspaceId', 'sources'], label);
    const rawSources = candidate.sources;
    const sources = decodeHistoryTurnSources(candidate.sources, label).map((source, index) => {
        const sourceLabel = `${label} source ${index + 1}`;
        const raw = object(rawSources[index], sourceLabel);
        exactKeys(raw, [
            'sourceSessionId', 'sourceTurn', 'sourceBoundarySeq', 'sourceLabel',
        ], sourceLabel);
        const displayLabel = nonBlank(raw.sourceLabel, `${sourceLabel} sourceLabel`);
        if (!/^PA[1-9]\d*(?: fork)?$/.test(displayLabel)) {
            throw new Error(`${sourceLabel} sourceLabel must be a PA number`);
        }
        return { ...source, sourceLabel: displayLabel };
    });
    return {
        targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`),
        workspaceId: nonBlank(candidate.workspaceId, `${label} workspaceId`),
        sources,
    };
}
export function decodeCreateAnchoredSessionResponse(value) {
    const label = 'dsh-git create anchored session response';
    const candidate = object(value, label);
    exactKeys(candidate, ['targetSessionId'], label);
    return { targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`) };
}
/** Validate an Anchor Workspace request without accepting a browser-supplied path. */
export function decodeCreateAnchorWorkspaceRequest(value) {
    const label = 'dsh-git create anchor workspace request';
    const candidate = object(value, label);
    exactKeys(candidate, ['sourceSessionId', 'title', 'sources'], label);
    const title = nonBlank(candidate.title, `${label} title`).trim();
    if (title.length > 200)
        throw new Error(`${label} title must not exceed 200 characters`);
    const sources = decodeHistoryTurnSources(candidate.sources, label);
    const rawSources = candidate.sources;
    rawSources.forEach((source, index) => {
        const sourceLabel = `${label} source ${index + 1}`;
        exactKeys(object(source, sourceLabel), [
            'sourceSessionId', 'sourceTurn', 'sourceBoundarySeq',
        ], sourceLabel);
    });
    return {
        sourceSessionId: nonBlank(candidate.sourceSessionId, `${label} sourceSessionId`),
        title,
        sources,
    };
}
export function decodeCreateAnchorWorkspaceResponse(value) {
    const label = 'dsh-git create anchor workspace response';
    const candidate = object(value, label);
    exactKeys(candidate, ['workspaceId', 'workspacePath', 'workspaceTitle'], label);
    return {
        workspaceId: nonBlank(candidate.workspaceId, `${label} workspaceId`),
        workspacePath: nonBlank(candidate.workspacePath, `${label} workspacePath`),
        workspaceTitle: nonBlank(candidate.workspaceTitle, `${label} workspaceTitle`),
    };
}
/** Validate an Anchor cleanup request without accepting a browser-supplied path. */
export function decodeCancelAnchorWorkspaceRequest(value) {
    const label = 'dsh-git cancel anchor workspace request';
    const candidate = object(value, label);
    exactKeys(candidate, ['sourceSessionId', 'workspaceId', 'sources'], label);
    let sources;
    if (candidate.sources !== undefined) {
        sources = decodeHistoryTurnSources(candidate.sources, label);
        const rawSources = candidate.sources;
        rawSources.forEach((source, index) => {
            const sourceLabel = `${label} source ${index + 1}`;
            exactKeys(object(source, sourceLabel), [
                'sourceSessionId', 'sourceTurn', 'sourceBoundarySeq',
            ], sourceLabel);
        });
    }
    return {
        sourceSessionId: nonBlank(candidate.sourceSessionId, `${label} sourceSessionId`),
        workspaceId: nonBlank(candidate.workspaceId, `${label} workspaceId`),
        ...(sources === undefined ? {} : { sources }),
    };
}
export function decodeCancelAnchorWorkspaceResponse(value) {
    const label = 'dsh-git cancel anchor workspace response';
    const candidate = object(value, label);
    exactKeys(candidate, ['removed'], label);
    return { removed: boolean(candidate.removed, `${label} removed`) };
}
/** Strictly validate the untrusted project graph RPC request. */
export function decodeProjectGraphRequest(value) {
    const candidate = object(value, 'dsh-git project graph request');
    return { workspaceId: nonBlank(candidate.workspaceId, 'workspaceId') };
}
/** Validate seed-recovered merge lineage arriving across Connection. */
function decodeMergeSources(value, label) {
    if (!Array.isArray(value))
        throw new Error(`${label} mergeSources must be an array`);
    return value.map((raw, index) => {
        const source = object(raw, `${label} mergeSource ${index + 1}`);
        const positive = (candidate, field) => {
            const parsed = nonNegativeInteger(candidate, `${label} mergeSource ${index + 1} ${field}`);
            if (parsed < 1)
                throw new Error(`${label} mergeSource ${index + 1} ${field} must be positive`);
            return parsed;
        };
        const sourceLabel = source.sourceLabel === undefined
            ? undefined
            : nonBlank(source.sourceLabel, `${label} mergeSource ${index + 1} sourceLabel`);
        if (sourceLabel !== undefined && !/^PA[1-9]\d*(?: fork)?$/.test(sourceLabel)) {
            throw new Error(`${label} mergeSource ${index + 1} sourceLabel must be a PA number`);
        }
        return {
            ...(source.viaSessionId === undefined ? {} : { viaSessionId: nonBlank(source.viaSessionId, `${label} viaSessionId`) }),
            sourceSessionId: nonBlank(source.sourceSessionId, `${label} mergeSource ${index + 1} sourceSessionId`),
            sourceTurn: positive(source.sourceTurn, 'sourceTurn'),
            sourceBoundarySeq: nonNegativeInteger(source.sourceBoundarySeq, `${label} mergeSource ${index + 1} sourceBoundarySeq`),
            targetTurn: positive(source.targetTurn, 'targetTurn'),
            ...(sourceLabel === undefined ? {} : { sourceLabel }),
        };
    });
}
/** Validate the ledger-read request; the state schema is enforced by the Host domain. */
export function decodeGraphReadRequest(value) {
    const candidate = object(value, 'dsh-git graph read request');
    return { scopeId: nonBlank(candidate.scopeId, 'scopeId') };
}
/** Validate the ledger-read response envelope received across Connection. */
export function decodeGraphReadResponse(value) {
    const candidate = object(value, 'dsh-git graph read response');
    const state = candidate.state;
    if (state !== null && (typeof state !== 'object' || Array.isArray(state))) {
        throw new Error('dsh-git graph read response state must be an object or null');
    }
    return { scopeId: nonBlank(candidate.scopeId, 'scopeId'), state };
}
/** Validate the ledger-write envelope; `state` is parsed against the domain schema. */
export function decodeGraphWriteRequest(value) {
    const candidate = object(value, 'dsh-git graph write request');
    const state = object(candidate.state, 'dsh-git graph write request state');
    return { scopeId: nonBlank(candidate.scopeId, 'scopeId'), state,
        expectedRevision: nonNegativeInteger(candidate.expectedRevision, 'expectedRevision') };
}
/** Strictly validate the project graph response received across Connection. */
export function decodeProjectGraphResponse(value) {
    const candidate = object(value, 'dsh-git project graph response');
    const workspaceId = nonBlank(candidate.workspaceId, 'workspaceId');
    if (!Array.isArray(candidate.sessions))
        throw new Error('sessions must be an array');
    const sessions = candidate.sessions.map((rawSession, sessionIndex) => {
        const session = object(rawSession, `session ${sessionIndex + 1}`);
        const sessionId = nonBlank(session.sessionId, `session ${sessionIndex + 1} sessionId`);
        const createdAt = nonNegativeInteger(session.createdAt, `session ${sessionIndex + 1} createdAt`);
        const seedLength = nonNegativeInteger(session.seedLength, `session ${sessionIndex + 1} seedLength`);
        const parentSessionId = session.parentSessionId === undefined
            ? undefined
            : nonBlank(session.parentSessionId, `session ${sessionIndex + 1} parentSessionId`);
        if (!Array.isArray(session.turns))
            throw new Error(`session ${sessionIndex + 1} turns must be an array`);
        const turns = session.turns.map((rawTurn, turnIndex) => {
            const turn = object(rawTurn, `session ${sessionIndex + 1} turn ${turnIndex + 1}`);
            const turnNumber = nonNegativeInteger(turn.turn, `session ${sessionIndex + 1} turn number`);
            if (turnNumber < 1)
                throw new Error(`session ${sessionIndex + 1} turn number must be positive`);
            if (typeof turn.prompt !== 'string' || typeof turn.answer !== 'string') {
                throw new Error(`session ${sessionIndex + 1} turn ${turnIndex + 1} text must be strings`);
            }
            if (typeof turn.inherited !== 'boolean') {
                throw new Error(`session ${sessionIndex + 1} turn ${turnIndex + 1} inherited must be boolean`);
            }
            return {
                turn: turnNumber,
                prompt: turn.prompt,
                answer: turn.answer,
                startedAt: nonNegativeInteger(turn.startedAt, `session ${sessionIndex + 1} turn ${turnIndex + 1} startedAt`),
                completedAt: nonNegativeInteger(turn.completedAt, `session ${sessionIndex + 1} turn ${turnIndex + 1} completedAt`),
                boundarySeq: nonNegativeInteger(turn.boundarySeq, `session ${sessionIndex + 1} turn ${turnIndex + 1} boundarySeq`),
                inherited: turn.inherited,
                fingerprint: nonBlank(turn.fingerprint, `session ${sessionIndex + 1} turn ${turnIndex + 1} fingerprint`),
            };
        });
        const mergeSources = session.mergeSources === undefined
            ? undefined
            : decodeMergeSources(session.mergeSources, `session ${sessionIndex + 1}`);
        return {
            sessionId,
            createdAt,
            ...(parentSessionId === undefined ? {} : { parentSessionId }),
            seedLength,
            ...(mergeSources === undefined ? {} : { mergeSources }),
            turns,
        };
    });
    return { workspaceId, sessions };
}
//# sourceMappingURL=protocol.js.map