export const CREATE_MERGED_SESSION_COMMAND = 'dsh-git-create-merged-session';
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