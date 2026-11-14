import { EMPTY_GRAPH_STATE } from "../graph-state.js";
import { GRAPH_READ_ENDPOINT, GRAPH_WRITE_ENDPOINT, PROJECT_GRAPH_RPC_CHANNEL, decodeGraphReadResponse, } from "../protocol.js";
function normalize(state) {
    if (state === null)
        return EMPTY_GRAPH_STATE;
    if (typeof state !== 'object')
        throw new Error('Invalid graph ledger');
    const candidate = state;
    if (candidate.format !== 1)
        throw new Error('Unsupported graph ledger version');
    return { ...EMPTY_GRAPH_STATE, ...candidate };
}
/**
 * Bind the ledger endpoints to a Connection.
 *
 * Writes are serialized per scope: the repository commits synchronously to
 * memory and hands the resulting snapshot here, so two overlapping calls would
 * otherwise be free to land on the medium out of order and leave the durable
 * ledger behind the one on screen.
 */
export function connectionGraphTransport(connection) {
    const revisions = new Map();
    const chains = new Map();
    return {
        async read(scopeId) {
            const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, GRAPH_READ_ENDPOINT, { scopeId });
            if (!result.ok)
                throw new Error(result.error.message);
            const response = decodeGraphReadResponse(result.value);
            if (response.scopeId !== scopeId)
                throw new Error('Graph scope mismatch');
            const state = normalize(response.state);
            revisions.set(scopeId, state.revision ?? 0);
            return state;
        },
        write(scopeId, state) {
            const previous = chains.get(scopeId) ?? Promise.resolve();
            const next = previous.then(async () => {
                const expectedRevision = revisions.get(scopeId);
                if (expectedRevision === undefined)
                    throw new Error('Read the graph before writing');
                const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, GRAPH_WRITE_ENDPOINT, { scopeId, state, expectedRevision });
                if (!result.ok)
                    throw new Error(result.error.message);
                revisions.set(scopeId, expectedRevision + 1);
            });
            // Keep the chain alive past a rejected write so one failure cannot wedge
            // the scope; the caller still receives the rejection it asked for.
            chains.set(scopeId, next.catch(() => undefined));
            return next;
        },
    };
}
//# sourceMappingURL=graph-transport.js.map