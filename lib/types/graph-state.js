/**
 * The durable conversation-graph ledger, shared by both bundle halves.
 *
 * Types only — the Host owns the storage domain and its zod schemas
 * (`./graph-domain.ts`), the browser owns the observable repository
 * (`./client/repository.ts`), and neither may pull the other's runtime in.
 */
/** The ledger a scope starts from before its first completed turn. */
export const EMPTY_GRAPH_STATE = {
    format: 1,
    nodes: {},
    branches: {},
    sessionBranches: {},
    sessionTurnRefs: {},
    pendingMerges: {},
    headNodeId: null,
    previewNodeId: null,
    contextManifest: [],
};
//# sourceMappingURL=graph-state.js.map