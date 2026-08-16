import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets';
import { SessionId } from '@deepseek-ai/dsh-session';
import { GRAPH_DOMAIN, assertScopeId, graphStateSchema } from "./graph-domain.js";
import { buildMergedSessionSeed } from "./history.js";
import { projectHistoryPreview } from "./history-preview.js";
import { projectSession } from "./project-history.js";
import { CREATE_MERGED_SESSION_RPC_ENDPOINT, GRAPH_READ_ENDPOINT, GRAPH_WRITE_ENDPOINT, HISTORY_PREVIEW_RPC_ENDPOINT, PROJECT_GRAPH_RPC_CHANNEL, PROJECT_GRAPH_RPC_ENDPOINT, decodeCreateMergedSessionRequest, decodeGraphReadRequest, decodeGraphWriteRequest, decodeHistoryPreviewRequest, decodeProjectGraphRequest, } from "./protocol.js";
export const name = 'dsh-git';
export const inject = [
    'agents', 'agentPresets', 'connection', 'sessionQuery', 'storageDomain', 'workspaceRegistry',
];
/** Repair merge sessions created by versions that copied cwd but forgot Workspace membership. */
async function repairWorkspaceMembership(ctx) {
    const workspaces = ctx.workspaceRegistry.list();
    const grouped = new Set(workspaces.flatMap(workspace => workspace.sessionIds));
    const records = await ctx.sessionQuery.listSessions();
    for (const record of records) {
        const sessionId = record.header.id;
        if (!String(sessionId).startsWith('dsh-git-') || grouped.has(sessionId))
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
/** Create one merged child using the final tray source as its official parent. */
export async function createMergedSession(ctx, payload, signal) {
    const request = decodeCreateMergedSessionRequest(payload);
    signal.throwIfAborted();
    const targetSessionId = SessionId(request.targetSessionId);
    if (ctx.agents.get(targetSessionId) !== undefined) {
        throw new Error(`target session "${targetSessionId}" already exists`);
    }
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
    const primarySessionId = SessionId(request.sources.at(-1).sourceSessionId);
    const primary = await readSession(primarySessionId);
    const seed = await buildMergedSessionSeed(targetSessionId, request.sources, readSession);
    signal.throwIfAborted();
    const sourceWorkspace = ctx.workspaceRegistry.list()
        .find(workspace => workspace.sessionIds.includes(primarySessionId));
    const preset = resolveSessionPreset({ header: primary.session, events: primary.events });
    await ctx.agents.create({
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
    });
    // Once creation publishes, finish durable Workspace membership even if the
    // browser disconnects: leaving a hidden orphan would violate the merge contract.
    if (sourceWorkspace !== undefined)
        await sourceWorkspace.attachSession(targetSessionId);
    return { targetSessionId };
}
/** Mount the trusted RPCs used by the browser half. */
export async function apply(ctx) {
    await repairWorkspaceMembership(ctx);
    const domain = await ctx.storageDomain.open(GRAPH_DOMAIN);
    const scopes = domain.table('scopes');
    ctx.effect(() => () => domain.close(), 'dsh-git: graph ledger domain');
    /** Read every completed PA of one Workspace straight from the canonical logs. */
    const readProjectGraph = async (payload) => {
        const request = decodeProjectGraphRequest(payload);
        const workspace = ctx.workspaceRegistry.list()
            .find(candidate => candidate.id === request.workspaceId);
        if (workspace === undefined)
            throw new Error(`workspace "${request.workspaceId}" was not found`);
        const sessions = await Promise.all(workspace.sessionIds.map(async (sessionId) => projectSession(await ctx.sessionQuery.readSession(SessionId(sessionId)))));
        sessions.sort((left, right) => left.createdAt - right.createdAt
            || left.sessionId.localeCompare(right.sessionId));
        return { ok: true, value: { workspaceId: request.workspaceId, sessions } };
    };
    /** Project selected completed turns exactly as the merged seed will copy them. */
    const readHistoryPreview = async (payload, signal) => {
        const request = decodeHistoryPreviewRequest(payload);
        signal.throwIfAborted();
        const value = await projectHistoryPreview(request.sources, async (sessionId) => {
            signal.throwIfAborted();
            const snapshot = await ctx.sessionQuery.readSession(sessionId);
            signal.throwIfAborted();
            return snapshot;
        });
        signal.throwIfAborted();
        return { ok: true, value };
    };
    ctx.connection.rpc.handle(PROJECT_GRAPH_RPC_CHANNEL, async (endpoint, payload, signal) => {
        try {
            switch (endpoint) {
                case CREATE_MERGED_SESSION_RPC_ENDPOINT:
                    return { ok: true, value: await createMergedSession(ctx, payload, signal) };
                case PROJECT_GRAPH_RPC_ENDPOINT:
                    return await readProjectGraph(payload);
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
                    await scopes.put(scopeId, graphStateSchema.parse(request.state));
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