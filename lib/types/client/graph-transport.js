import { EMPTY_GRAPH_STATE } from "../graph-state.js";
import { GRAPH_READ_ENDPOINT, GRAPH_WRITE_ENDPOINT, PROJECT_GRAPH_RPC_CHANNEL, decodeGraphReadResponse, } from "../protocol.js";
function normalize(state) {
    if (state === null || typeof state !== 'object')
        return EMPTY_GRAPH_STATE;
    const candidate = state;
    if (candidate.format !== 1)
        return EMPTY_GRAPH_STATE;
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
    const chains = new Map();
    return {
        async read(scopeId) {
            const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, GRAPH_READ_ENDPOINT, { scopeId });
            if (!result.ok)
                throw new Error(result.error.message);
            return normalize(decodeGraphReadResponse(result.value).state);
        },
        write(scopeId, state) {
            const previous = chains.get(scopeId) ?? Promise.resolve();
            const next = previous.then(async () => {
                const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, GRAPH_WRITE_ENDPOINT, { scopeId, state });
                if (!result.ok)
                    throw new Error(result.error.message);
            });
            // Keep the chain alive past a rejected write so one failure cannot wedge
            // the scope; the caller still receives the rejection it asked for.
            chains.set(scopeId, next.catch(() => undefined));
            return next;
        },
    };
}
//# sourceMappingURL=graph-transport.js.map