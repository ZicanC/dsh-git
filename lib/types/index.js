import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { forkOrigin } from "./fork-origin.js";
import { finalizeGraph } from "./graph-ledger.js";
import { GRAPH_DOMAIN, assertScopeId, graphStateSchema } from "./graph-domain.js";
import { buildMergedSessionSeed } from "./history.js";
import { projectHistoryPreview } from "./history-preview.js";
import { readMergeLineage } from "./merge-lineage.js";
import { projectSession } from "./project-history.js";
import { ANCHORED_SESSION_PREFIX, CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT, CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT, CREATE_ANCHORED_SESSION_RPC_ENDPOINT, CREATE_MERGED_SESSION_RPC_ENDPOINT, GRAPH_READ_ENDPOINT, GRAPH_WRITE_ENDPOINT, HISTORY_PREVIEW_RPC_ENDPOINT, PROJECT_GRAPH_RPC_CHANNEL, PROJECT_GRAPH_RPC_ENDPOINT, decodeCancelAnchorWorkspaceRequest, decodeCreateAnchorWorkspaceRequest, decodeCreateAnchoredSessionRequest, decodeCreateMergedSessionRequest, decodeGraphReadRequest, decodeGraphWriteRequest, decodeHistoryPreviewRequest, decodeProjectGraphRequest, isAnchoredSessionId, } from "./protocol.js";
export const name = 'dsh-git';
export const inject = [
    'agents', 'agentPresets', 'connection', 'sessionQuery', 'storageDomain', 'workspaceRegistry',
];
const ANCHOR_WORKSPACE_MARKER = '.dsh-git-anchor';
function anchorWorkspaceMarkerPath(workspacePath) {
    return join(workspacePath, ANCHOR_WORKSPACE_MARKER);
}
async function readAnchorWorkspaceMarker(markerPath) {
    try {
        const marker = JSON.parse(await readFile(markerPath, 'utf8'));
        if (typeof marker !== 'object' || marker === null || Array.isArray(marker))
            return undefined;
        const sourceWorkspacePath = marker.sourceWorkspacePath;
        const anchorKey = marker.anchorKey;
        if (typeof sourceWorkspacePath !== 'string'
            || (anchorKey !== undefined && typeof anchorKey !== 'string'))
            return undefined;
        return { sourceWorkspacePath, ...(anchorKey === undefined ? {} : { anchorKey }) };
    }
    catch {
        return undefined;
    }
}
async function belongsToSourceWorkspace(markerPath, sourceWorkspacePath) {
    return (await readAnchorWorkspaceMarker(markerPath))?.sourceWorkspacePath === sourceWorkspacePath;
}
/** Stable identity for one order-insensitive set of Host history coordinates. */
function anchorSourceKey(sources) {
    const coordinates = sources.map(source => [
        source.sourceSessionId, source.sourceTurn, source.sourceBoundarySeq,
    ]).sort((left, right) => left[0].localeCompare(right[0])
        || left[1] - right[1]
        || left[2] - right[2]);
    return createHash('sha256').update(JSON.stringify(coordinates)).digest('hex');
}
function isAnchorWorkspaceChild(workspace, sourceWorkspace) {
    return dirname(workspace.path) === sourceWorkspace.path
        && basename(workspace.path).startsWith('dsh-git-anchors-');
}
/**
 * Read the effective preset from the durable session record.
 *
 * `agent-preset/selected` supersedes the immutable creation header while a
 * session is blank. The Harness no longer exports this convenience helper,
 * and this query snapshot does not expose its projection, so fold the same
 * small log-backed rule here.
 */
function resolveSessionPreset(header, events) {
    let preset = header.agentPreset;
    for (const event of events) {
        if (event.type === 'agent-preset/selected')
            preset = event.data.agentPreset;
    }
    return preset;
}
/** Recover identity from old markers by reading any existing anchored child lineage. */
async function recoverLegacyAnchorKey(ctx, workspace, signal) {
    for (const sessionId of workspace.sessionIds) {
        if (!isAnchoredSessionId(String(sessionId)))
            continue;
        signal.throwIfAborted();
        try {
            const snapshot = await ctx.sessionQuery.readSession(SessionId(sessionId));
            signal.throwIfAborted();
            const sources = readMergeLineage(snapshot.events)?.sources;
            if (sources !== undefined && sources.length > 0)
                return anchorSourceKey(sources);
        }
        catch (error) {
            signal.throwIfAborted();
            ctx.logger.warn(`failed to recover Anchor Workspace identity from "${sessionId}": ${String(error)}`);
        }
    }
    return undefined;
}
async function findReusableAnchorWorkspace(ctx, workspaces, sourceWorkspace, requestedKey, signal) {
    for (const workspace of workspaces) {
        if (!isAnchorWorkspaceChild(workspace, sourceWorkspace))
            continue;
        const markerPath = anchorWorkspaceMarkerPath(workspace.path);
        const marker = await readAnchorWorkspaceMarker(markerPath);
        if (marker?.sourceWorkspacePath !== sourceWorkspace.path)
            continue;
        if (marker.anchorKey === requestedKey)
            return workspace;
        if (marker.anchorKey !== undefined)
            continue;
        const recoveredKey = await recoverLegacyAnchorKey(ctx, workspace, signal);
        if (recoveredKey !== requestedKey)
            continue;
        await writeFile(markerPath, JSON.stringify({
            sourceWorkspacePath: sourceWorkspace.path,
            anchorKey: recoveredKey,
        }), { encoding: 'utf8', flag: 'w' }).catch(() => undefined);
        return workspace;
    }
    return undefined;
}
/** Repair merge sessions created by versions that copied cwd but forgot Workspace membership. */
async function repairWorkspaceMembership(ctx) {
    const workspaces = ctx.workspaceRegistry.list();
    const grouped = new Set(workspaces.flatMap(workspace => workspace.sessionIds));
    const records = await ctx.sessionQuery.listSessions();
    for (const record of records) {
        const sessionId = record.header.id;
        if (!String(sessionId).startsWith('dsh-git-')
            || isAnchoredSessionId(String(sessionId))
            || grouped.has(sessionId))
            continue;
        const parentSession = record.header.parentSession;
        if (parentSession === undefined)
            continue;
        const workspace = workspaces.find(candidate => candidate.sessionIds.includes(parentSession));
        if (workspace === undefined)
            continue;
        try {
            await workspace.attachSession(sessionId);
            grouped.add(sessionId);
        }
        catch (error) {
            ctx.logger.warn(`failed to restore workspace membership for "${sessionId}": ${String(error)}`);
        }
    }
}
/** Report one handler failure without leaking a stack across the Connection boundary. */
function failure(error) {
    return {
        ok: false,
        error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
    };
}
/** The Session a composed child is created under: the one its last source was selected through. */
function primarySourceSessionId(sources) {
    const last = sources.at(-1);
    return SessionId(last.viaSessionId ?? last.sourceSessionId);
}
/**
 * Read every Session of a Workspace that can be read.
 *
 * One log Harness refuses to load must not hide the rest of the Workspace, so
 * a failed read is logged and that Session is left out.
 */
async function readWorkspaceSessions(ctx, workspace, read) {
    const snapshots = await Promise.all(workspace.sessionIds.map(async (sessionId) => {
        try {
            return await read(SessionId(sessionId));
        }
        catch (error) {
            ctx.logger.warn(`failed to read Session "${sessionId}" of Workspace "${workspace.id}": ${String(error)}`);
            return undefined;
        }
    }));
    return snapshots.flatMap(snapshot => snapshot === undefined ? [] : [snapshot]);
}
/**
 * Compose the selected turns into a seed and create the child Agent from it.
 *
 * The last source's Session — the one it was selected through — is the child's
 * official parent and supplies its preset. Each source Session's log is read
 * once per request however many of its turns were selected.
 * @param cwdOf - working directory for the child, given the parent's snapshot.
 * @returns the child's handle and the seed it was created from.
 */
async function createComposedAgent(ctx, targetSessionId, sources, signal, cwdOf) {
    const snapshots = new Map();
    const readSession = async (sessionId) => {
        const existing = snapshots.get(sessionId);
        if (existing !== undefined)
            return existing;
        signal.throwIfAborted();
        const snapshot = await ctx.sessionQuery.readSession(sessionId);
        signal.throwIfAborted();
        snapshots.set(sessionId, snapshot);
        return snapshot;
    };
    // An official fork's origin is looked for among the Sessions it shares a
    // Workspace with, and only when a selected turn lies in an inherited prefix.
    const forkOriginOf = async (fork) => {
        const workspace = ctx.workspaceRegistry.list()
            .find(candidate => candidate.sessionIds.includes(fork.session.id));
        if (workspace === undefined)
            return undefined;
        const siblings = await readWorkspaceSessions(ctx, workspace, readSession);
        signal.throwIfAborted();
        return forkOrigin(fork, siblings);
    };
    const primarySessionId = primarySourceSessionId(sources);
    const primary = await readSession(primarySessionId);
    const seed = await buildMergedSessionSeed(targetSessionId, sources, readSession, forkOriginOf);
    signal.throwIfAborted();
    const preset = resolveSessionPreset(primary.session, primary.events);
    const cwd = cwdOf(primary);
    const handle = await ctx.agents.create({
        sessionId: targetSessionId,
        seed,
        inheritedEventCount: SessionLogOffset(seed.length),
        meta: {
            ...(cwd === undefined ? {} : { cwd }),
            parentSession: primarySessionId,
            isSeeded: true,
            ...(preset === undefined ? {} : { agentPreset: preset }),
        },
        signal,
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
    });
    return { handle, seed };
}
/**
 * Finish durable Workspace membership for a just-created child.
 *
 * Once creation publishes, membership completes even if the browser
 * disconnects. If it fails, the child is disposed so the failed transaction
 * cannot leave a hidden orphan Session behind.
 */
async function attachOrDispose(workspace, handle, targetSessionId) {
    try {
        await workspace.attachSession(targetSessionId);
    }
    catch (error) {
        await handle.dispose();
        throw error;
    }
}
/** Create one merged child using the final tray source as its official parent. */
export async function createMergedSession(ctx, payload, signal) {
    const request = decodeCreateMergedSessionRequest(payload);
    signal.throwIfAborted();
    const targetSessionId = SessionId(request.targetSessionId);
    if (ctx.agents.get(targetSessionId) !== undefined) {
        throw new Error(`target session "${targetSessionId}" already exists`);
    }
    const { handle, seed } = await createComposedAgent(ctx, targetSessionId, request.sources, signal, primary => primary.session.cwd);
    const primarySessionId = primarySourceSessionId(request.sources);
    const sourceWorkspace = ctx.workspaceRegistry.list()
        .find(workspace => workspace.sessionIds.includes(primarySessionId));
    if (sourceWorkspace !== undefined)
        await attachOrDispose(sourceWorkspace, handle, targetSessionId);
    return {
        targetSessionId,
        turnBoundaries: seed.flatMap(event => event.type === 'turn/end' ? [event.seq] : []),
    };
}
/** Create one strict-isolation child in the dedicated Anchor Workspace. */
export async function createAnchoredSession(ctx, payload, signal) {
    const request = decodeCreateAnchoredSessionRequest(payload);
    signal.throwIfAborted();
    if (!request.targetSessionId.startsWith(ANCHORED_SESSION_PREFIX)) {
        throw new Error(`anchored target session must start with "${ANCHORED_SESSION_PREFIX}"`);
    }
    const targetSessionId = SessionId(request.targetSessionId);
    if (ctx.agents.get(targetSessionId) !== undefined) {
        throw new Error(`target session "${targetSessionId}" already exists`);
    }
    const targetWorkspace = ctx.workspaceRegistry.list()
        .find(workspace => String(workspace.id) === request.workspaceId);
    if (targetWorkspace === undefined) {
        throw new Error(`anchor workspace "${request.workspaceId}" was not found`);
    }
    const { handle } = await createComposedAgent(ctx, targetSessionId, request.sources, signal, () => targetWorkspace.path);
    await attachOrDispose(targetWorkspace, handle, targetSessionId);
    return { targetSessionId };
}
/** Reuse or create the dedicated child Workspace for one exact Anchor source set. */
export async function createAnchorWorkspace(ctx, payload, signal) {
    const request = decodeCreateAnchorWorkspaceRequest(payload);
    signal.throwIfAborted();
    const sourceSessionId = SessionId(request.sourceSessionId);
    const workspaces = ctx.workspaceRegistry.list();
    const sourceWorkspace = workspaces
        .find(workspace => workspace.sessionIds.includes(sourceSessionId));
    if (sourceWorkspace === undefined) {
        throw new Error(`source session "${sourceSessionId}" is not in a Workspace`);
    }
    const anchorKey = anchorSourceKey(request.sources);
    const reusable = await findReusableAnchorWorkspace(ctx, workspaces, sourceWorkspace, anchorKey, signal);
    if (reusable !== undefined)
        return {
            workspaceId: String(reusable.id),
            workspacePath: reusable.path,
            workspaceTitle: reusable.title,
        };
    // The browser never supplies a filesystem path. mkdtemp atomically creates
    // exactly one direct child of the verified source Workspace.
    const workspacePath = await mkdtemp(join(sourceWorkspace.path, 'dsh-git-anchors-'));
    const markerPath = anchorWorkspaceMarkerPath(workspacePath);
    try {
        await writeFile(markerPath, JSON.stringify({
            sourceWorkspacePath: sourceWorkspace.path,
            anchorKey,
        }), {
            encoding: 'utf8', flag: 'wx',
        });
        // Once the directory exists, complete registration even if the caller
        // disconnects so strict-isolation state never points at a hidden folder.
        const workspace = await ctx.workspaceRegistry.create(workspacePath, request.title);
        return {
            workspaceId: String(workspace.id),
            workspacePath: workspace.path,
            workspaceTitle: workspace.title,
        };
    }
    catch (error) {
        // This operation exclusively owns the newly created, still-empty folder.
        await unlink(markerPath).catch(() => undefined);
        await rmdir(workspacePath).catch(() => undefined);
        throw error;
    }
}
/** Leave Anchor mode without deleting its durable, reusable Anchor Workspace. */
export async function cancelAnchorWorkspace(ctx, payload, signal) {
    const request = decodeCancelAnchorWorkspaceRequest(payload);
    signal.throwIfAborted();
    const workspaces = ctx.workspaceRegistry.list();
    const sourceWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(SessionId(request.sourceSessionId)));
    const targetWorkspace = workspaces.find(workspace => String(workspace.id) === request.workspaceId);
    if (sourceWorkspace === undefined || targetWorkspace === undefined
        || !isAnchorWorkspaceChild(targetWorkspace, sourceWorkspace)
        || !await belongsToSourceWorkspace(anchorWorkspaceMarkerPath(targetWorkspace.path), sourceWorkspace.path)) {
        return { removed: false };
    }
    if (request.sources !== undefined) {
        const markerPath = anchorWorkspaceMarkerPath(targetWorkspace.path);
        const marker = await readAnchorWorkspaceMarker(markerPath);
        if (marker !== undefined && marker.anchorKey === undefined) {
            await writeFile(markerPath, JSON.stringify({
                sourceWorkspacePath: sourceWorkspace.path,
                anchorKey: anchorSourceKey(request.sources),
            }), { encoding: 'utf8', flag: 'w' });
        }
    }
    // Cancellation only clears the browser's active Anchor state. The Host-owned
    // directory stays registered so selecting this exact source set can resume it.
    return { removed: false };
}
/** Read every completed PA belonging to exactly one Workspace. */
export async function readProjectGraph(ctx, payload) {
    const request = decodeProjectGraphRequest(payload);
    const workspace = ctx.workspaceRegistry.list()
        .find(candidate => candidate.id === request.workspaceId);
    if (workspace === undefined)
        throw new Error(`workspace "${request.workspaceId}" was not found`);
    // Anchor children only belong to their dedicated Workspace. Include them
    // here; Workspace membership, rather than an ID-prefix filter, isolates them.
    const snapshots = await readWorkspaceSessions(ctx, workspace, sessionId => ctx.sessionQuery.readSession(sessionId));
    const sessions = snapshots.map(snapshot => projectSession(snapshot, forkOrigin(snapshot, snapshots)));
    sessions.sort((left, right) => left.createdAt - right.createdAt
        || left.sessionId.localeCompare(right.sessionId));
    return { ok: true, value: { workspaceId: request.workspaceId, sessions } };
}
/** Mount the trusted RPCs used by the browser half. */
export async function apply(ctx) {
    await repairWorkspaceMembership(ctx);
    const domain = await ctx.storageDomain.open(GRAPH_DOMAIN);
    const scopes = domain.table('scopes');
    const graphWrites = new Map();
    ctx.effect(() => () => domain.close(), 'dsh-git: graph ledger domain');
    /** Project selected completed turns exactly as the merged seed will copy them. */
    const readHistoryPreview = async (payload, signal) => {
        const request = decodeHistoryPreviewRequest(payload);
        signal.throwIfAborted();
        // Several selected turns usually share one source Session; reading its log
        // once per request keeps a multi-PA preview at one read per Session.
        const snapshots = new Map();
        const value = await projectHistoryPreview(request.sources, async (sessionId) => {
            signal.throwIfAborted();
            const existing = snapshots.get(sessionId);
            if (existing !== undefined)
                return await existing;
            const pending = ctx.sessionQuery.readSession(sessionId);
            snapshots.set(sessionId, pending);
            const snapshot = await pending;
            signal.throwIfAborted();
            return snapshot;
        });
        signal.throwIfAborted();
        return { ok: true, value };
    };
    ctx.connection.rpc.handle(PROJECT_GRAPH_RPC_CHANNEL, async (endpoint, payload, signal) => {
        try {
            switch (endpoint) {
                case CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT:
                    return { ok: true, value: await cancelAnchorWorkspace(ctx, payload, signal) };
                case CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT:
                    return { ok: true, value: await createAnchorWorkspace(ctx, payload, signal) };
                case CREATE_ANCHORED_SESSION_RPC_ENDPOINT:
                    return { ok: true, value: await createAnchoredSession(ctx, payload, signal) };
                case CREATE_MERGED_SESSION_RPC_ENDPOINT:
                    return { ok: true, value: await createMergedSession(ctx, payload, signal) };
                case PROJECT_GRAPH_RPC_ENDPOINT:
                    return await readProjectGraph(ctx, payload);
                case HISTORY_PREVIEW_RPC_ENDPOINT:
                    return await readHistoryPreview(payload, signal);
                case GRAPH_READ_ENDPOINT: {
                    const scopeId = assertScopeId(decodeGraphReadRequest(payload).scopeId);
                    return { ok: true, value: { scopeId, state: scopes.get(scopeId) ?? null } };
                }
                case GRAPH_WRITE_ENDPOINT: {
                    const request = decodeGraphWriteRequest(payload);
                    const scopeId = assertScopeId(request.scopeId);
                    // Parse before `put` so a malformed ledger is rejected at the seam,
                    // not by the domain's own boundary check after the call is in flight.
                    const write = (graphWrites.get(scopeId) ?? Promise.resolve()).then(async () => {
                        const current = scopes.get(scopeId);
                        if ((current?.revision ?? 0) !== request.expectedRevision) {
                            throw new Error('Graph changed in another client. Reload before saving; the stored graph was preserved.');
                        }
                        const parsed = graphStateSchema.parse(request.state);
                        const next = finalizeGraph({ ...parsed, revision: request.expectedRevision + 1 });
                        await scopes.put(scopeId, graphStateSchema.parse(next));
                    });
                    graphWrites.set(scopeId, write.catch(() => undefined));
                    await write;
                    return { ok: true, value: { scopeId } };
                }
                default:
                    throw new Error(`unknown dsh-git endpoint "${endpoint}"`);
            }
        }
        catch (error) {
            return failure(error);
        }
    }, { authority: 'trusted-host' });
}
//# sourceMappingURL=index.js.map