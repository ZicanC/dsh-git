/**
 * Host-side durable home of the conversation graph.
 *
 * One record per scope — a Workspace folder, or a single Session that belongs
 * to no folder — stored whole so a reader never sees nodes and edges disagree.
 * The zod schemas here run twice: `storage-domain` validates every record at
 * the durable boundary, and the RPC handler validates the same shape coming off
 * the wire, so an untrusted browser payload cannot widen what reaches the medium.
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { assertGraphSemantics } from './graph-ledger.ts'
import type { GraphState } from './graph-state.ts'

/** Ledger owner: one Workspace folder, or one folder-less Session. */
export type GraphScopeId = string & { readonly __graphScope: unique symbol }

/**
 * Longest accepted scope id. Scope ids are record keys, never file-path
 * segments, so the cap only bounds what one untrusted call can allocate.
 */
export const MAX_SCOPE_ID_LENGTH = 512

const nodeId = z.string().min(1)

const turnNodeSchema = z.object({
  id: nodeId,
  paId: nodeId.optional(),
  ledgerOrdinal: z.number().int().positive().optional(),
  finalOrdinal: z.number().int().positive().optional(),
  contextKnown: z.boolean().optional(),
  contextRefs: z.array(z.object({ paId: nodeId, viaSessionId: nodeId })).optional(),
  displayLabel: z.string().regex(/^(PA[1-9]\d*(?: fork)?|S[1-9]\d*\.[1-9]\d*)$/).optional(),
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
})

const branchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sessionId: z.string().min(1),
  headId: nodeId.nullable(),
  color: z.number().int(),
  createdAt: z.number(),
})

const pendingMergeSchema = z.object({
  contextRefs: z.array(z.object({ paId: nodeId, viaSessionId: nodeId })).optional(),
  branchId: z.string().min(1),
  parentIds: z.array(nodeId),
  primaryParentId: nodeId.nullable(),
  contextManifest: z.array(nodeId),
  // Kept optional so format-1 ledgers written by the old ask-and-merge flow still load.
  prompt: z.string().optional(),
})

const anchorModeSchema = z.object({
  sourceSessionId: z.string().min(1),
  nodeIds: z.array(nodeId).min(1),
  workspaceId: z.string().min(1),
  workspacePath: z.string().min(1),
  workspaceTitle: z.string().min(1),
  createdAt: z.number(),
})

/** One scope's complete ledger, as stored and as accepted off the wire. */
const storedGraphShape: z.ZodType<GraphState> = z.object({
  format: z.literal(1),
  revision: z.number().int().nonnegative().optional(),
  ledgerSequence: z.number().int().nonnegative().optional(),
  finalSequence: z.number().int().nonnegative().optional(),
  nodes: z.record(z.string(), turnNodeSchema),
  branches: z.record(z.string(), branchSchema),
  sessionBranches: z.record(z.string(), z.string().min(1)),
  // JSON object keys are strings; the turn number is recovered by the reader.
  sessionTurnRefs: z.record(z.string(), z.record(z.string(), nodeId)),
  pendingMerges: z.record(z.string(), pendingMergeSchema),
  // Optional on disk so ledgers written before anchor mode still load.
  anchors: z.record(z.string(), anchorModeSchema).default({}),
  headNodeId: nodeId.nullable(),
  previewNodeId: nodeId.nullable(),
  contextManifest: z.array(nodeId),
})

/** Existing format-1 records remain readable; every new write receives semantic validation. */
export const graphStateSchema = storedGraphShape.superRefine((state, ctx) => {
  try { assertGraphSemantics(state) } catch (error: unknown) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
})

/**
 * The graph domain. `UNIT_NAME_RE` is `/^[a-z][a-z0-9_]*$/`, so the domain and
 * table names are underscore-separated rather than matching the package name.
 */
export const GRAPH_DOMAIN = defineDomain({
  name: 'dsh_git_graph',
  version: 1,
  tables: {
    scopes: domainTable<GraphScopeId, GraphState>(storedGraphShape),
  },
})

/** Reject a scope id that is blank or larger than one record key should be. */
export function assertScopeId(value: unknown): GraphScopeId {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('dsh-git graph scopeId must be a non-blank string')
  }
  if (value.length > MAX_SCOPE_ID_LENGTH) {
    throw new Error(`dsh-git graph scopeId exceeds ${MAX_SCOPE_ID_LENGTH} characters`)
  }
  return value as GraphScopeId
}
