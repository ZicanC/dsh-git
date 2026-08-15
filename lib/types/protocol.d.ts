import type { MergeLineageSource } from './merge-lineage.ts';
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
/** Endpoints backing the Host-owned graph ledger. */
export declare const GRAPH_READ_ENDPOINT = "graph/read";
export declare const GRAPH_WRITE_ENDPOINT = "graph/write";
/** Browser request for one scope's stored ledger. */
export interface GraphReadRequest {
    readonly scopeId: string;
}
/** Stored ledger for one scope; `null` before the scope's first write. */
export interface GraphReadResponse {
    readonly scopeId: string;
    readonly state: unknown | null;
}
/** Browser request replacing one scope's stored ledger. */
export interface GraphWriteRequest {
    readonly scopeId: string;
    readonly state: unknown;
}
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
    /** Present only on dsh-git merge branches; recovered from the seed lineage event. */
    readonly mergeSources?: readonly MergeLineageSource[];
    readonly turns: readonly ProjectTurnDTO[];
}
/** Complete read-only history used to assemble one project graph. */
export interface ProjectGraphResponse {
    readonly workspaceId: string;
    readonly sessions: readonly ProjectSessionDTO[];
}
/** Strictly validate the untrusted project graph RPC request. */
export declare function decodeProjectGraphRequest(value: unknown): ProjectGraphRequest;
/** Validate the ledger-read request; the state schema is enforced by the Host domain. */
export declare function decodeGraphReadRequest(value: unknown): GraphReadRequest;
/** Validate the ledger-read response envelope received across Connection. */
export declare function decodeGraphReadResponse(value: unknown): GraphReadResponse;
/** Validate the ledger-write envelope; `state` is parsed against the domain schema. */
export declare function decodeGraphWriteRequest(value: unknown): GraphWriteRequest;
/** Strictly validate the project graph response received across Connection. */
export declare function decodeProjectGraphResponse(value: unknown): ProjectGraphResponse;
/** Encode the small JSON payload without exposing selected conversation text in the command log. */
export declare function encodeCreateMergedSessionPayload(payload: CreateMergedSessionPayload): string;
/** Decode and strictly validate an untrusted slash-command payload. */
export declare function decodeCreateMergedSessionPayload(rawInput: string): CreateMergedSessionPayload;
