/** Host half: creates a new Agent from multiple selected turns as real session history. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {} from './connection-contract.ts'
import { GRAPH_DOMAIN, assertScopeId, graphStateSchema } from './graph-domain.ts'
import { buildMergedSessionSeed } from './history.ts'
import { projectHistoryPreview } from './history-preview.ts'
import { readMergeLineage } from './merge-lineage.ts'
import { projectSession } from './project-history.ts'
import {
  ANCHORED_SESSION_PREFIX,
  CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT,
  CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT,
  CREATE_ANCHORED_SESSION_RPC_ENDPOINT,
  CREATE_MERGED_SESSION_RPC_ENDPOINT,
  GRAPH_READ_ENDPOINT,
  GRAPH_WRITE_ENDPOINT,
  HISTORY_PREVIEW_RPC_ENDPOINT,
  PROJECT_GRAPH_RPC_CHANNEL,
  PROJECT_GRAPH_RPC_ENDPOINT,
  decodeCancelAnchorWorkspaceRequest,
  decodeCreateAnchorWorkspaceRequest,
  decodeCreateAnchoredSessionRequest,
  decodeCreateMergedSessionRequest,
  decodeGraphReadRequest,
  decodeGraphWriteRequest,
  decodeHistoryPreviewRequest,
  decodeProjectGraphRequest,
  isAnchoredSessionId,
  type CancelAnchorWorkspaceResponse,
  type CreateAnchorWorkspaceResponse,
  type CreateAnchoredSessionResponse,
  type CreateMergedSessionResponse,
  type HistoryTurnSource,
} from './protocol.ts'

export const name = 'dsh-git'
export const inject = [
  'agents', 'agentPresets', 'connection', 'sessionQuery', 'storageDomain', 'workspaceRegistry',
]

const ANCHOR_WORKSPACE_MARKER = '.dsh-git-anchor'

interface AnchorWorkspaceMarker {
  readonly sourceWorkspacePath: string
  readonly anchorKey?: string
}

function anchorWorkspaceMarkerPath(workspacePath: string): string {
  return join(workspacePath, ANCHOR_WORKSPACE_MARKER)
}

async function readAnchorWorkspaceMarker(markerPath: string): Promise<AnchorWorkspaceMarker | undefined> {
  try {
    const marker: unknown = JSON.parse(await readFile(markerPath, 'utf8'))
    if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) return undefined
    const sourceWorkspacePath = (marker as Record<string, unknown>).sourceWorkspacePath
    const anchorKey = (marker as Record<string, unknown>).anchorKey
    if (typeof sourceWorkspacePath !== 'string'
      || (anchorKey !== undefined && typeof anchorKey !== 'string')) return undefined
    return { sourceWorkspacePath, ...(anchorKey === undefined ? {} : { anchorKey }) }
  } catch {
    return undefined
  }
}

async function belongsToSourceWorkspace(markerPath: string, sourceWorkspacePath: string): Promise<boolean> {
  return (await readAnchorWorkspaceMarker(markerPath))?.sourceWorkspacePath === sourceWorkspacePath
}

/** Stable identity for one order-insensitive set of Host history coordinates. */
function anchorSourceKey(sources: readonly HistoryTurnSource[]): string {
  const coordinates = sources.map(source => [
    source.sourceSessionId, source.sourceTurn, source.sourceBoundarySeq,
  ] as const).sort((left, right) => left[0].localeCompare(right[0])
    || left[1] - right[1]
    || left[2] - right[2])
  return createHash('sha256').update(JSON.stringify(coordinates)).digest('hex')
}

function isAnchorWorkspaceChild(workspace: Workspace, sourceWorkspace: Workspace): boolean {
  return dirname(workspace.path) === sourceWorkspace.path
    && basename(workspace.path).startsWith('dsh-git-anchors-')
}

/** Recover identity from old markers by reading any existing anchored child lineage. */
async function recoverLegacyAnchorKey(
  ctx: Context,
  workspace: Workspace,
  signal: AbortSignal,
): Promise<string | undefined> {
  for (const sessionId of workspace.sessionIds) {
    if (!isAnchoredSessionId(String(sessionId))) continue
    signal.throwIfAborted()
    try {
      const snapshot = await ctx.sessionQuery.readSession(SessionId(sessionId))
      signal.throwIfAborted()
      const sources = readMergeLineage(snapshot.events)?.sources
      if (sources !== undefined && sources.length > 0) return anchorSourceKey(sources)
    } catch (error: unknown) {
      signal.throwIfAborted()
      ctx.logger.warn(`failed to recover Anchor Workspace identity from "${sessionId}": ${String(error)}`)
    }
  }
  return undefined
}

async function findReusableAnchorWorkspace(
  ctx: Context,
  workspaces: readonly Workspace[],
  sourceWorkspace: Workspace,
  requestedKey: string,
  signal: AbortSignal,
): Promise<Workspace | undefined> {
  for (const workspace of workspaces) {
    if (!isAnchorWorkspaceChild(workspace, sourceWorkspace)) continue
    const markerPath = anchorWorkspaceMarkerPath(workspace.path)
    const marker = await readAnchorWorkspaceMarker(markerPath)
    if (marker?.sourceWorkspacePath !== sourceWorkspace.path) continue
    if (marker.anchorKey === requestedKey) return workspace
    if (marker.anchorKey !== undefined) continue
    const recoveredKey = await recoverLegacyAnchorKey(ctx, workspace, signal)
    if (recoveredKey !== requestedKey) continue
    await writeFile(markerPath, JSON.stringify({
      sourceWorkspacePath: sourceWorkspace.path,
      anchorKey: recoveredKey,
    }), { encoding: 'utf8', flag: 'w' }).catch(() => undefined)
    return workspace
  }
  return undefined
}

/** Repair merge sessions created by versions that copied cwd but forgot Workspace membership. */
async function repairWorkspaceMembership(ctx: Context): Promise<void> {
  const workspaces = ctx.workspaceRegistry.list()
  const grouped = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
  const records = await ctx.sessionQuery.listSessions()
  for (const record of records) {
    const sessionId = record.header.id
    if (!String(sessionId).startsWith('dsh-git-')
      || isAnchoredSessionId(String(sessionId))
      || grouped.has(sessionId)) continue
    const parentSession = record.header.parentSession
    if (parentSession === undefined) continue
    const workspace = workspaces.find(candidate => candidate.sessionIds.includes(parentSession))
    if (workspace === undefined) continue
    try {
      await workspace.attachSession(sessionId)
      grouped.add(sessionId)
    } catch (error: unknown) {
      ctx.logger.warn(`failed to restore workspace membership for "${sessionId}": ${String(error)}`)
    }
  }
}

/** Report one handler failure without leaking a stack across the Connection boundary. */
function failure(error: unknown): { ok: false; error: { code: string; message: string; details: object } } {
  return {
    ok: false,
    error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
  }
}

/** Create one merged child using the final tray source as its official parent. */
export async function createMergedSession(
  ctx: Context,
  payload: unknown,
  signal: AbortSignal,
): Promise<CreateMergedSessionResponse> {
  const request = decodeCreateMergedSessionRequest(payload)
  signal.throwIfAborted()
  const targetSessionId = SessionId(request.targetSessionId)
  if (ctx.agents.get(targetSessionId) !== undefined) {
    throw new Error(`target session "${targetSessionId}" already exists`)
  }

  const snapshots = new Map<string, Awaited<ReturnType<typeof ctx.sessionQuery.readSession>>>()
  const readSession = async (sessionId: ReturnType<typeof SessionId>) => {
    const existing = snapshots.get(sessionId)
    if (existing !== undefined) return existing
    signal.throwIfAborted()
    const snapshot = await ctx.sessionQuery.readSession(sessionId)
    signal.throwIfAborted()
    snapshots.set(sessionId, snapshot)
    return snapshot
  }
  const primarySessionId = SessionId(request.sources.at(-1)!.sourceSessionId)
  const primary = await readSession(primarySessionId)
  const seed = await buildMergedSessionSeed(targetSessionId, request.sources, readSession)
  signal.throwIfAborted()

  const sourceWorkspace = ctx.workspaceRegistry.list()
    .find(workspace => workspace.sessionIds.includes(primarySessionId))
  const preset = resolveSessionPreset({ header: primary.session, events: primary.events })
  const handle = await ctx.agents.create({
    sessionId: targetSessionId,
    seed,
    meta: {
      ...(primary.session.cwd === undefined ? {} : { cwd: primary.session.cwd }),
      parentSession: primarySessionId,
      seedLength: seed.length,
      ...(preset === undefined ? {} : { agentPreset: preset }),
    },
    signal,
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
  })
  // Once creation publishes, finish durable Workspace membership even if the
  // browser disconnects. If membership fails, dispose the just-created child
  // so the failed transaction cannot leave a hidden orphan Session behind.
  if (sourceWorkspace !== undefined) {
    try {
      await sourceWorkspace.attachSession(targetSessionId)
    } catch (error: unknown) {
      await handle.dispose()
      throw error
    }
  }
  return { targetSessionId }
}

/** Create one strict-isolation child in the dedicated Anchor Workspace. */
export async function createAnchoredSession(
  ctx: Context,
  payload: unknown,
  signal: AbortSignal,
): Promise<CreateAnchoredSessionResponse> {
  const request = decodeCreateAnchoredSessionRequest(payload)
  signal.throwIfAborted()
  if (!request.targetSessionId.startsWith(ANCHORED_SESSION_PREFIX)) {
    throw new Error(`anchored target session must start with "${ANCHORED_SESSION_PREFIX}"`)
  }
  const targetSessionId = SessionId(request.targetSessionId)
  if (ctx.agents.get(targetSessionId) !== undefined) {
    throw new Error(`target session "${targetSessionId}" already exists`)
  }
  const targetWorkspace = ctx.workspaceRegistry.list()
    .find(workspace => String(workspace.id) === request.workspaceId)
  if (targetWorkspace === undefined) {
    throw new Error(`anchor workspace "${request.workspaceId}" was not found`)
  }

  const snapshots = new Map<string, Awaited<ReturnType<typeof ctx.sessionQuery.readSession>>>()
  const readSession = async (sessionId: ReturnType<typeof SessionId>) => {
    const existing = snapshots.get(sessionId)
    if (existing !== undefined) return existing
    signal.throwIfAborted()
    const snapshot = await ctx.sessionQuery.readSession(sessionId)
    signal.throwIfAborted()
    snapshots.set(sessionId, snapshot)
    return snapshot
  }
  const primarySessionId = SessionId(request.sources.at(-1)!.sourceSessionId)
  const primary = await readSession(primarySessionId)
  const seed = await buildMergedSessionSeed(targetSessionId, request.sources, readSession)
  signal.throwIfAborted()
  const preset = resolveSessionPreset({ header: primary.session, events: primary.events })
  const handle = await ctx.agents.create({
    sessionId: targetSessionId,
    seed,
    meta: {
      cwd: targetWorkspace.path,
      parentSession: primarySessionId,
      seedLength: seed.length,
      ...(preset === undefined ? {} : { agentPreset: preset }),
    },
    signal,
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
  })
  try {
    await targetWorkspace.attachSession(targetSessionId)
  } catch (error: unknown) {
    await handle.dispose()
    throw error
  }
  return { targetSessionId }
}

/** Reuse or create the dedicated child Workspace for one exact Anchor source set. */
export async function createAnchorWorkspace(
  ctx: Context,
  payload: unknown,
  signal: AbortSignal,
): Promise<CreateAnchorWorkspaceResponse> {
  const request = decodeCreateAnchorWorkspaceRequest(payload)
  signal.throwIfAborted()
  const sourceSessionId = SessionId(request.sourceSessionId)
  const workspaces = ctx.workspaceRegistry.list()
  const sourceWorkspace = workspaces
    .find(workspace => workspace.sessionIds.includes(sourceSessionId))
  if (sourceWorkspace === undefined) {
    throw new Error(`source session "${sourceSessionId}" is not in a Workspace`)
  }
  const anchorKey = anchorSourceKey(request.sources)
  const reusable = await findReusableAnchorWorkspace(
    ctx, workspaces, sourceWorkspace, anchorKey, signal,
  )
  if (reusable !== undefined) return {
    workspaceId: String(reusable.id),
    workspacePath: reusable.path,
    workspaceTitle: reusable.title,
  }

  // The browser never supplies a filesystem path. mkdtemp atomically creates
  // exactly one direct child of the verified source Workspace.
  const workspacePath = await mkdtemp(join(sourceWorkspace.path, 'dsh-git-anchors-'))
  const markerPath = anchorWorkspaceMarkerPath(workspacePath)
  try {
    await writeFile(markerPath, JSON.stringify({
      sourceWorkspacePath: sourceWorkspace.path,
      anchorKey,
    }), {
      encoding: 'utf8', flag: 'wx',
    })
    // Once the directory exists, complete registration even if the caller
    // disconnects so strict-isolation state never points at a hidden folder.
    const workspace = await ctx.workspaceRegistry.create(workspacePath, request.title)
    return {
      workspaceId: String(workspace.id),
      workspacePath: workspace.path,
      workspaceTitle: workspace.title,
    }
  } catch (error: unknown) {
    // This operation exclusively owns the newly created, still-empty folder.
    await unlink(markerPath).catch(() => undefined)
    await rmdir(workspacePath).catch(() => undefined)
    throw error
  }
}

/** Leave Anchor mode without deleting its durable, reusable Anchor Workspace. */
export async function cancelAnchorWorkspace(
  ctx: Context,
  payload: unknown,
  signal: AbortSignal,
): Promise<CancelAnchorWorkspaceResponse> {
  const request = decodeCancelAnchorWorkspaceRequest(payload)
  signal.throwIfAborted()
  const workspaces = ctx.workspaceRegistry.list()
  const sourceWorkspace = workspaces.find(workspace =>
    workspace.sessionIds.includes(SessionId(request.sourceSessionId)))
  const targetWorkspace = workspaces.find(workspace => String(workspace.id) === request.workspaceId)
  if (sourceWorkspace === undefined || targetWorkspace === undefined
    || !isAnchorWorkspaceChild(targetWorkspace, sourceWorkspace)
    || !await belongsToSourceWorkspace(
      anchorWorkspaceMarkerPath(targetWorkspace.path), sourceWorkspace.path,
    )) {
    return { removed: false }
  }

  if (request.sources !== undefined) {
    const markerPath = anchorWorkspaceMarkerPath(targetWorkspace.path)
    const marker = await readAnchorWorkspaceMarker(markerPath)
    if (marker !== undefined && marker.anchorKey === undefined) {
      await writeFile(markerPath, JSON.stringify({
        sourceWorkspacePath: sourceWorkspace.path,
        anchorKey: anchorSourceKey(request.sources),
      }), { encoding: 'utf8', flag: 'w' })
    }
  }

  // Cancellation only clears the browser's active Anchor state. The Host-owned
  // directory stays registered so selecting this exact source set can resume it.
  return { removed: false }
}

/** Read every completed PA belonging to exactly one Workspace. */
export async function readProjectGraph(
  ctx: Context,
  payload: unknown,
): Promise<{ ok: true; value: unknown }> {
  const request = decodeProjectGraphRequest(payload)
  const workspace = ctx.workspaceRegistry.list()
    .find(candidate => candidate.id === request.workspaceId)
  if (workspace === undefined) throw new Error(`workspace "${request.workspaceId}" was not found`)
  // Anchor children only belong to their dedicated Workspace. Include them
  // here; Workspace membership, rather than an ID-prefix filter, isolates them.
  const sessions = await Promise.all(workspace.sessionIds.map(async sessionId =>
    projectSession(await ctx.sessionQuery.readSession(SessionId(sessionId)))))
  sessions.sort((left, right) => left.createdAt - right.createdAt
    || left.sessionId.localeCompare(right.sessionId))
  return { ok: true, value: { workspaceId: request.workspaceId, sessions } }
}

/** Mount the trusted RPCs used by the browser half. */
export async function apply(ctx: Context): Promise<void> {
  await repairWorkspaceMembership(ctx)
  const domain = await ctx.storageDomain.open(GRAPH_DOMAIN)
  const scopes = domain.table('scopes')
  ctx.effect(() => () => domain.close(), 'dsh-git: graph ledger domain')

  /** Project selected completed turns exactly as the merged seed will copy them. */
  const readHistoryPreview = async (
    payload: unknown,
    signal: AbortSignal,
  ): Promise<{ ok: true; value: unknown }> => {
    const request = decodeHistoryPreviewRequest(payload)
    signal.throwIfAborted()
    // Several selected turns usually share one source Session; reading its log
    // once per request keeps a multi-PA preview at one read per Session.
    const snapshots = new Map<string, Promise<Awaited<ReturnType<typeof ctx.sessionQuery.readSession>>>>()
    const value = await projectHistoryPreview(request.sources, async (sessionId) => {
      signal.throwIfAborted()
      const existing = snapshots.get(sessionId)
      if (existing !== undefined) return await existing
      const pending = ctx.sessionQuery.readSession(sessionId)
      snapshots.set(sessionId, pending)
      const snapshot = await pending
      signal.throwIfAborted()
      return snapshot
    })
    signal.throwIfAborted()
    return { ok: true, value }
  }

  ctx.connection.rpc.handle(PROJECT_GRAPH_RPC_CHANNEL, async (endpoint, payload, signal) => {
    try {
      switch (endpoint) {
        case CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT:
          return { ok: true, value: await cancelAnchorWorkspace(ctx, payload, signal) }
        case CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT:
          return { ok: true, value: await createAnchorWorkspace(ctx, payload, signal) }
        case CREATE_ANCHORED_SESSION_RPC_ENDPOINT:
          return { ok: true, value: await createAnchoredSession(ctx, payload, signal) }
        case CREATE_MERGED_SESSION_RPC_ENDPOINT:
          return { ok: true, value: await createMergedSession(ctx, payload, signal) }
        case PROJECT_GRAPH_RPC_ENDPOINT:
          return await readProjectGraph(ctx, payload)
        case HISTORY_PREVIEW_RPC_ENDPOINT:
          return await readHistoryPreview(payload, signal)
        case GRAPH_READ_ENDPOINT: {
          const scopeId = assertScopeId(decodeGraphReadRequest(payload).scopeId)
          return { ok: true, value: { scopeId, state: scopes.get(scopeId) ?? null } }
        }
        case GRAPH_WRITE_ENDPOINT: {
          const request = decodeGraphWriteRequest(payload)
          const scopeId = assertScopeId(request.scopeId)
          // Parse before `put` so a malformed ledger is rejected at the seam,
          // not by the domain's own boundary check after the call is in flight.
          await scopes.put(scopeId, graphStateSchema.parse(request.state))
          return { ok: true, value: { scopeId } }
        }
        default:
          throw new Error(`unknown dsh-git endpoint "${endpoint}"`)
      }
    } catch (error: unknown) {
      return failure(error)
    }
  }, { authority: 'trusted-host' })
}
