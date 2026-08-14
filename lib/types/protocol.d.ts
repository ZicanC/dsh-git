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
/** Generic Connection channel and endpoint used by the project graph reader. */
export declare const PROJECT_GRAPH_RPC_CHANNEL = "/dsh-git";
export declare const PROJECT_GRAPH_RPC_ENDPOINT = "workspace/graph";
/** Browser request for the complete completed-turn history of one Workspace. */
export interface ProjectGraphRequest {
    readonly workspaceId: string;
}
/** One completed Prompt + Answer turn returned by the Host. */
export interface ProjectTurnDTO {
    readonly turn: number;
    readonly prompt: string;
    readonly answer: string;
    readonly startedAt: number;
    readonly completedAt: number;
    readonly boundarySeq: number;
    readonly inherited: boolean;
    readonly fingerprint: string;
}
/** One Workspace member Session and its completed turns. */
export interface ProjectSessionDTO {
    readonly sessionId: string;
    readonly createdAt: number;
    readonly parentSessionId?: string;
    readonly seedLength: number;
    readonly turns: readonly ProjectTurnDTO[];
}
/** Complete read-only history used to assemble one project graph. */
export interface ProjectGraphResponse {
    readonly workspaceId: string;
    readonly sessions: readonly ProjectSessionDTO[];
}
/** Strictly validate the untrusted project graph RPC request. */
export declare function decodeProjectGraphRequest(value: unknown): ProjectGraphRequest;
/** Strictly validate the project graph response received across Connection. */
export declare function decodeProjectGraphResponse(value: unknown): ProjectGraphResponse;
/** Encode the small JSON payload without exposing selected conversation text in the command log. */
export declare function encodeCreateMergedSessionPayload(payload: CreateMergedSessionPayload): string;
/** Decode and strictly validate an untrusted slash-command payload. */
export declare function decodeCreateMergedSessionPayload(rawInput: string): CreateMergedSessionPayload;
