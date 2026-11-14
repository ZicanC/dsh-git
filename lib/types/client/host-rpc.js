import { CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT, CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT, CREATE_ANCHORED_SESSION_RPC_ENDPOINT, CREATE_MERGED_SESSION_RPC_ENDPOINT, HISTORY_PREVIEW_RPC_ENDPOINT, PROJECT_GRAPH_RPC_CHANNEL, PROJECT_GRAPH_RPC_ENDPOINT, decodeCancelAnchorWorkspaceResponse, decodeCreateAnchorWorkspaceResponse, decodeCreateAnchoredSessionResponse, decodeCreateMergedSessionResponse, decodeHistoryPreviewResponse, decodeProjectGraphResponse, } from "../protocol.js";
/** The Host answered and refused; `message` is the Host's own wording. */
export class HostRefusal extends Error {
}
/**
 * Re-word a Host refusal for the user, for use as a `catch` handler.
 * Any other failure — an abort, a reply of the wrong shape — passes through.
 */
export function rewordRefusal(describe) {
    return (cause) => {
        throw cause instanceof HostRefusal ? new Error(describe(cause.message)) : cause;
    };
}
/** Bind the Host operations to a Connection. */
export function hostRpc(connection) {
    const call = async (endpoint, payload, decode, signal) => {
        const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, endpoint, payload, signal);
        if (!result.ok)
            throw new HostRefusal(result.error.message);
        return decode(result.value);
    };
    return {
        readProjectGraph: (workspaceId, signal) => call(PROJECT_GRAPH_RPC_ENDPOINT, { workspaceId }, decodeProjectGraphResponse, signal),
        readHistoryPreview: (sources, signal) => call(HISTORY_PREVIEW_RPC_ENDPOINT, { sources }, decodeHistoryPreviewResponse, signal),
        createMergedSession: (request, signal) => call(CREATE_MERGED_SESSION_RPC_ENDPOINT, request, decodeCreateMergedSessionResponse, signal),
        createAnchoredSession: (request, signal) => call(CREATE_ANCHORED_SESSION_RPC_ENDPOINT, request, decodeCreateAnchoredSessionResponse, signal),
        createAnchorWorkspace: (request, signal) => call(CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT, request, decodeCreateAnchorWorkspaceResponse, signal),
        cancelAnchorWorkspace: (request, signal) => call(CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT, request, decodeCancelAnchorWorkspaceResponse, signal),
    };
}
//# sourceMappingURL=host-rpc.js.map