/**
 * Host-side durable home of the conversation graph.
 *
 * One record per scope — a Workspace folder, or a single Session that belongs
 * to no folder — stored whole so a reader never sees nodes and edges disagree.
 * The zod schemas here run twice: `storage-domain` validates every record at
 * the durable boundary, and the RPC handler validates the same shape coming off
 * the wire, so an untrusted browser payload cannot widen what reaches the medium.
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
/**
 * Longest accepted scope id. Scope ids are record keys, never file-path
 * segments, so the cap only bounds what one untrusted call can allocate.
 */
export const MAX_SCOPE_ID_LENGTH = 512;
const nodeId = z.string().min(1);
const turnNodeSchema = z.object({
    id: nodeId,
    sessionId: z.string().min(1),
    turn: z.number().int().nonnegative(),
    prompt: z.string(),
    answer: z.string(),
    createdAt: z.number(),
    boundarySeq: z.number().int().nonnegative(),
    primaryParentId: nodeId.nullable(),
    parentIds: z.array(nodeId),
    contextManifest: z.array(nodeId),
    branchId: z.string().min(1),
    forkSourceId: nodeId.optional(),
});
const branchSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    sessionId: z.string().min(1),
    headId: nodeId.nullable(),
    color: z.number().int(),
    createdAt: z.number(),
});
const pendingMergeSchema = z.object({
    branchId: z.string().min(1),
    parentIds: z.array(nodeId),
    primaryParentId: nodeId.nullable(),
    contextManifest: z.array(nodeId),
    // Kept optional so format-1 ledgers written by the old ask-and-merge flow still load.
    prompt: z.string().optional(),
});
/** One scope's complete ledger, as stored and as accepted off the wire. */
export const graphStateSchema = z.object({
    format: z.literal(1),
    nodes: z.record(z.string(), turnNodeSchema),
    branches: z.record(z.string(), branchSchema),
    sessionBranches: z.record(z.string(), z.string().min(1)),
    // JSON object keys are strings; the turn number is recovered by the reader.
    sessionTurnRefs: z.record(z.string(), z.record(z.string(), nodeId)),
    pendingMerges: z.record(z.string(), pendingMergeSchema),
    headNodeId: nodeId.nullable(),
    previewNodeId: nodeId.nullable(),
    contextManifest: z.array(nodeId),
});
/**
 * The graph domain. `UNIT_NAME_RE` is `/^[a-z][a-z0-9_]*$/`, so the domain and
 * table names are underscore-separated rather than matching the package name.
 */
export const GRAPH_DOMAIN = defineDomain({
    name: 'dsh_git_graph',
    version: 1,
    tables: {
        scopes: domainTable(graphStateSchema),
    },
});
/** Reject a scope id that is blank or larger than one record key should be. */
export function assertScopeId(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('dsh-git graph scopeId must be a non-blank string');
    }
    if (value.length > MAX_SCOPE_ID_LENGTH) {
        throw new Error(`dsh-git graph scopeId exceeds ${MAX_SCOPE_ID_LENGTH} characters`);
    }
    return value;
}
//# sourceMappingURL=graph-domain.js.map