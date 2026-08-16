import type { MergeLineageSource } from './merge-lineage.ts';
/** One graph node selected as a real historical turn in a new session. */
export interface HistoryTurnSource {
    readonly sourceSessionId: string;
    readonly sourceTurn: number;
    readonly sourceBoundarySeq: number;
}
/** Trusted browser-to-Host request used to create a merged session. */
export interface CreateMergedSessionRequest {
    readonly targetSessionId: string;
    readonly sources: readonly HistoryTurnSource[];
}
/** Successful creation acknowledgement returned by the Host. */
export interface CreateMergedSessionResponse {
    readonly targetSessionId: string;
}
/** Generic Connection channel and endpoint used by the project graph reader. */
export declare const PROJECT_GRAPH_RPC_CHANNEL = "/dsh-git";
export declare const PROJECT_GRAPH_RPC_ENDPOINT = "workspace/graph";
export declare const HISTORY_PREVIEW_RPC_ENDPOINT = "history/preview";
export declare const CREATE_MERGED_SESSION_RPC_ENDPOINT = "session/create-merged";
/** Practical upper bound for one merged context while retaining full-session defaults. */
export declare const MAX_MERGED_HISTORY_TURNS = 512;
/** Endpoints backing the Host-owned graph ledger. */
export declare const GRAPH_READ_ENDPOINT = "graph/read";
export declare const GRAPH_WRITE_ENDPOINT = "graph/write";
/** Browser request for an ordered preview of selected historical turns. */
export interface HistoryPreviewRequest {
    readonly sources: readonly HistoryTurnSource[];
}
/** Lossless JSON vocabulary allowed across the private preview RPC. */
export type HistoryPreviewJsonValue = null | boolean | number | string | readonly HistoryPreviewJsonValue[] | {
    readonly [key: string]: HistoryPreviewJsonValue;
};
/** Serializable image reference retained from a user or assistant message. */
export interface HistoryPreviewImageAttachment {
    readonly attachmentId: string;
    readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
    readonly name?: string;
}
/** Provider-neutral message content used by the read-only chat preview. */
export type HistoryPreviewContentBlock = {
    readonly type: 'text';
    readonly text: string;
} | {
    readonly type: 'reasoning';
    readonly text: string;
} | {
    readonly type: 'image';
    readonly attachment: HistoryPreviewImageAttachment;
} | {
    readonly type: 'tool-call';
    readonly callId: string;
    readonly name: string;
    readonly arguments: string;
} | {
    readonly type: 'tool-result';
    readonly callId: string;
    readonly content: readonly HistoryPreviewContentBlock[];
    readonly isError: boolean;
} | {
    readonly type: 'other';
    readonly originalType: string;
    readonly value: HistoryPreviewJsonValue;
};
/** One displayable record in a selected turn, ordered by its merged-seed seq. */
export type HistoryPreviewRecord = {
    readonly kind: 'user';
    readonly seq: number;
    readonly messageId: string;
    readonly content: readonly HistoryPreviewContentBlock[];
    readonly source: HistoryPreviewJsonValue;
} | {
    readonly kind: 'assistant';
    readonly seq: number;
    readonly step: number;
    readonly messageId: string;
    readonly blocks: readonly HistoryPreviewContentBlock[];
    readonly provenance: {
        readonly provider: string;
        readonly model: string;
    };
    readonly usage?: HistoryPreviewJsonValue;
} | {
    readonly kind: 'tool-call';
    readonly seq: number;
    readonly step: number;
    readonly callId: string;
    readonly name: string;
    readonly arguments: string;
} | {
    readonly kind: 'tool-result';
    readonly seq: number;
    readonly step: number;
    readonly callId: string;
    readonly content: readonly HistoryPreviewContentBlock[];
    readonly isError: boolean;
    readonly error?: {
        readonly name: string;
        readonly code: string;
    };
    readonly meta?: HistoryPreviewJsonValue;
} | {
    readonly kind: 'request';
    readonly seq: number;
    readonly requestKind: 'header' | 'context';
    readonly data: HistoryPreviewJsonValue;
} | {
    readonly kind: 'turn-status';
    readonly seq: number;
    readonly status: string;
    readonly details: HistoryPreviewJsonValue;
} | {
    readonly kind: 'event';
    readonly seq: number;
    readonly eventType: string;
    readonly data: HistoryPreviewJsonValue;
};
/** One source PA projected at the target turn it will occupy after Merge. */
export interface HistoryPreviewTurnDTO {
    readonly source: HistoryTurnSource;
    readonly targetTurn: number;
    readonly records: readonly HistoryPreviewRecord[];
}
/** Complete ordered history preview returned by the Host. */
export interface HistoryPreviewResponse {
    readonly turns: readonly HistoryPreviewTurnDTO[];
}
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
/** Strictly validate an untrusted ordered history-preview request. */
export declare function decodeHistoryPreviewRequest(value: unknown): HistoryPreviewRequest;
/** Strictly validate the full Host history projection received across Connection. */
export declare function decodeHistoryPreviewResponse(value: unknown): HistoryPreviewResponse;
/** Strictly validate the trusted RPC request before creating any Host state. */
export declare function decodeCreateMergedSessionRequest(value: unknown): CreateMergedSessionRequest;
/** Strictly validate the Host acknowledgement received across Connection. */
export declare function decodeCreateMergedSessionResponse(value: unknown): CreateMergedSessionResponse;
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
