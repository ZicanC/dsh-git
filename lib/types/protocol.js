export const CREATE_MERGED_SESSION_COMMAND = 'dsh-git-create-merged-session';
/** Generic Connection channel and endpoint used by the project graph reader. */
export const PROJECT_GRAPH_RPC_CHANNEL = '/dsh-git';
export const PROJECT_GRAPH_RPC_ENDPOINT = 'workspace/graph';
/** Endpoints backing the Host-owned graph ledger. */
export const GRAPH_READ_ENDPOINT = 'graph/read';
export const GRAPH_WRITE_ENDPOINT = 'graph/write';
function object(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
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
        return {
            sourceSessionId: nonBlank(source.sourceSessionId, `${label} mergeSource ${index + 1} sourceSessionId`),
            sourceTurn: positive(source.sourceTurn, 'sourceTurn'),
            sourceBoundarySeq: nonNegativeInteger(source.sourceBoundarySeq, `${label} mergeSource ${index + 1} sourceBoundarySeq`),
            targetTurn: positive(source.targetTurn, 'targetTurn'),
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
    return { scopeId: nonBlank(candidate.scopeId, 'scopeId'), state };
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
/** Encode the small JSON payload without exposing selected conversation text in the command log. */
export function encodeCreateMergedSessionPayload(payload) {
    return encodeURIComponent(JSON.stringify(payload));
}
/** Decode and strictly validate an untrusted slash-command payload. */
export function decodeCreateMergedSessionPayload(rawInput) {
    let parsed;
    try {
        parsed = JSON.parse(decodeURIComponent(rawInput.trim()));
    }
    catch {
        throw new Error('dsh-git merge payload is not valid encoded JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('dsh-git merge payload must be an object');
    }
    const candidate = parsed;
    if (typeof candidate.targetSessionId !== 'string' || candidate.targetSessionId.trim() === '') {
        throw new Error('dsh-git merge payload requires targetSessionId');
    }
    if (!Array.isArray(candidate.sources) || candidate.sources.length === 0 || candidate.sources.length > 64) {
        throw new Error('dsh-git merge payload requires 1 to 64 source turns');
    }
    const sources = candidate.sources.map((source, index) => {
        if (typeof source !== 'object' || source === null || Array.isArray(source)) {
            throw new Error(`dsh-git source ${index + 1} must be an object`);
        }
        const value = source;
        if (typeof value.sourceSessionId !== 'string' || value.sourceSessionId.trim() === '') {
            throw new Error(`dsh-git source ${index + 1} requires sourceSessionId`);
        }
        if (!Number.isSafeInteger(value.sourceTurn) || value.sourceTurn < 1) {
            throw new Error(`dsh-git source ${index + 1} has an invalid sourceTurn`);
        }
        if (!Number.isSafeInteger(value.sourceBoundarySeq) || value.sourceBoundarySeq < 0) {
            throw new Error(`dsh-git source ${index + 1} has an invalid sourceBoundarySeq`);
        }
        return {
            sourceSessionId: value.sourceSessionId,
            sourceTurn: value.sourceTurn,
            sourceBoundarySeq: value.sourceBoundarySeq,
        };
    });
    return { targetSessionId: candidate.targetSessionId, sources };
}
//# sourceMappingURL=protocol.js.map