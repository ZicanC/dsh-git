/** Typed calls to the Host half over the `/dsh-git` channel. */
import type { ProjectConnection } from '../connection-contract.ts';
import { type CancelAnchorWorkspaceRequest, type CancelAnchorWorkspaceResponse, type CreateAnchorWorkspaceRequest, type CreateAnchorWorkspaceResponse, type CreateAnchoredSessionRequest, type CreateAnchoredSessionResponse, type CreateMergedSessionRequest, type CreateMergedSessionResponse, type HistoryPreviewResponse, type HistoryTurnSource, type ProjectGraphResponse } from '../protocol.ts';
/**
 * The Host operations the browser half calls, apart from the ledger's own
 * read and write (`./graph-transport.ts`).
 *
 * Every method rejects with a {@link HostRefusal} carrying the Host's message
 * when the Host refuses, and with the decoder's error when the reply is not
 * the shape the protocol promises.
 */
export interface HostRpc {
    readProjectGraph(workspaceId: string, signal: AbortSignal): Promise<ProjectGraphResponse>;
    readHistoryPreview(sources: readonly HistoryTurnSource[], signal: AbortSignal): Promise<HistoryPreviewResponse>;
    createMergedSession(request: CreateMergedSessionRequest, signal: AbortSignal): Promise<CreateMergedSessionResponse>;
    createAnchoredSession(request: CreateAnchoredSessionRequest, signal: AbortSignal): Promise<CreateAnchoredSessionResponse>;
    createAnchorWorkspace(request: CreateAnchorWorkspaceRequest, signal: AbortSignal): Promise<CreateAnchorWorkspaceResponse>;
    cancelAnchorWorkspace(request: CancelAnchorWorkspaceRequest, signal: AbortSignal): Promise<CancelAnchorWorkspaceResponse>;
}
/** The Host answered and refused; `message` is the Host's own wording. */
export declare class HostRefusal extends Error {
}
/**
 * Re-word a Host refusal for the user, for use as a `catch` handler.
 * Any other failure — an abort, a reply of the wrong shape — passes through.
 */
export declare function rewordRefusal(describe: (message: string) => string): (cause: unknown) => never;
/** Bind the Host operations to a Connection. */
export declare function hostRpc(connection: ProjectConnection): HostRpc;
