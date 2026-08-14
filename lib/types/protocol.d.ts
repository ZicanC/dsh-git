/** One graph node selected as a real historical turn in a new session. */
export interface HistoryTurnSource {
    readonly sourceSessionId: string;
    readonly sourceTurn: number;
    readonly sourceBoundarySeq: number;
}
/** Private browser-to-Host command payload used to create a merged session. */
export interface CreateMergedSessionPayload {
    readonly targetSessionId: string;
    readonly sources: readonly HistoryTurnSource[];
}
export declare const CREATE_MERGED_SESSION_COMMAND = "dsh-git-create-merged-session";
/** Encode the small JSON payload without exposing selected conversation text in the command log. */
export declare function encodeCreateMergedSessionPayload(payload: CreateMergedSessionPayload): string;
/** Decode and strictly validate an untrusted slash-command payload. */
export declare function decodeCreateMergedSessionPayload(rawInput: string): CreateMergedSessionPayload;
