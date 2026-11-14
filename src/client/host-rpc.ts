/** Typed calls to the Host half over the `/dsh-git` channel. */
import type { ProjectConnection } from '../connection-contract.ts'
import {
  CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT,
  CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT,
  CREATE_ANCHORED_SESSION_RPC_ENDPOINT,
  CREATE_MERGED_SESSION_RPC_ENDPOINT,
  HISTORY_PREVIEW_RPC_ENDPOINT,
  PROJECT_GRAPH_RPC_CHANNEL,
  PROJECT_GRAPH_RPC_ENDPOINT,
  decodeCancelAnchorWorkspaceResponse,
  decodeCreateAnchorWorkspaceResponse,
  decodeCreateAnchoredSessionResponse,
  decodeCreateMergedSessionResponse,
  decodeHistoryPreviewResponse,
  decodeProjectGraphResponse,
  type CancelAnchorWorkspaceRequest,
  type CancelAnchorWorkspaceResponse,
  type CreateAnchorWorkspaceRequest,
  type CreateAnchorWorkspaceResponse,
  type CreateAnchoredSessionRequest,
  type CreateAnchoredSessionResponse,
  type CreateMergedSessionRequest,
  type CreateMergedSessionResponse,
  type HistoryPreviewResponse,
  type HistoryTurnSource,
  type ProjectGraphResponse,
} from '../protocol.ts'

/**
 * The Host operations the browser half calls, apart from the ledger's own
 * read and write (`./graph-transport.ts`).
 *
 * Every method rejects with a {@link HostRefusal} carrying the Host's message
 * when the Host refuses, and with the decoder's error when the reply is not
 * the shape the protocol promises.
 */
export interface HostRpc {
  readProjectGraph(workspaceId: string, signal: AbortSignal): Promise<ProjectGraphResponse>
  readHistoryPreview(sources: readonly HistoryTurnSource[], signal: AbortSignal): Promise<HistoryPreviewResponse>
  createMergedSession(request: CreateMergedSessionRequest, signal: AbortSignal): Promise<CreateMergedSessionResponse>
  createAnchoredSession(request: CreateAnchoredSessionRequest, signal: AbortSignal): Promise<CreateAnchoredSessionResponse>
  createAnchorWorkspace(request: CreateAnchorWorkspaceRequest, signal: AbortSignal): Promise<CreateAnchorWorkspaceResponse>
  cancelAnchorWorkspace(request: CancelAnchorWorkspaceRequest, signal: AbortSignal): Promise<CancelAnchorWorkspaceResponse>
}

/** The Host answered and refused; `message` is the Host's own wording. */
export class HostRefusal extends Error {}

/**
 * Re-word a Host refusal for the user, for use as a `catch` handler.
 * Any other failure — an abort, a reply of the wrong shape — passes through.
 */
export function rewordRefusal(describe: (message: string) => string): (cause: unknown) => never {
  return (cause) => {
    throw cause instanceof HostRefusal ? new Error(describe(cause.message)) : cause
  }
}

/** Bind the Host operations to a Connection. */
export function hostRpc(connection: ProjectConnection): HostRpc {
  const call = async <T>(
    endpoint: string, payload: unknown, decode: (value: unknown) => T, signal: AbortSignal,
  ): Promise<T> => {
    const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, endpoint, payload, signal)
    if (!result.ok) throw new HostRefusal(result.error.message)
    return decode(result.value)
  }
  return {
    readProjectGraph: (workspaceId, signal) =>
      call(PROJECT_GRAPH_RPC_ENDPOINT, { workspaceId }, decodeProjectGraphResponse, signal),
    readHistoryPreview: (sources, signal) =>
      call(HISTORY_PREVIEW_RPC_ENDPOINT, { sources }, decodeHistoryPreviewResponse, signal),
    createMergedSession: (request, signal) =>
      call(CREATE_MERGED_SESSION_RPC_ENDPOINT, request, decodeCreateMergedSessionResponse, signal),
    createAnchoredSession: (request, signal) =>
      call(CREATE_ANCHORED_SESSION_RPC_ENDPOINT, request, decodeCreateAnchoredSessionResponse, signal),
    createAnchorWorkspace: (request, signal) =>
      call(CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT, request, decodeCreateAnchorWorkspaceResponse, signal),
    cancelAnchorWorkspace: (request, signal) =>
      call(CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT, request, decodeCancelAnchorWorkspaceResponse, signal),
  }
}
