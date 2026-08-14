import { GraphView } from "./GraphView.js";
import { installProjectBridge } from "./project-bridge.js";
import { WorkspaceGraphRepositories } from "./workspace-repositories.js";
import { STYLES } from "./styles.js";
import { CREATE_MERGED_SESSION_COMMAND, encodeCreateMergedSessionPayload, } from "../protocol.js";
import { installLocaleSource, localized } from "./i18n.js";
/** Required client services: the conversation view slot and session runtime. */
export const inject = ['connection', 'slots', 'sessions', 'workspaces', 'locale'];
function installStyles() {
    const existing = document.querySelector('style[data-plugin="dsh-git"]');
    if (existing !== null)
        return () => { };
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-git';
    style.textContent = STYLES;
    document.head.appendChild(style);
    return () => { style.remove(); };
}
function createSessionId() {
    const suffix = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `dsh-git-${suffix}`;
}
async function waitForSession(sessions, sessionId) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const binding = sessions.binding(sessionId);
        if (binding !== undefined)
            return binding;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    return undefined;
}
/** Mount the browser graph view and its process-local persistent repository. */
export function apply(ctx) {
    // Host and browser packages both augment Cordis' `sessions` name; this bundle runs on the browser face.
    const sessions = ctx.sessions;
    const repositories = new WorkspaceGraphRepositories(ctx.workspaces, typeof localStorage === 'undefined' ? undefined : localStorage);
    ctx.effect(() => installLocaleSource(ctx.locale), 'dsh-git: locale source');
    ctx.effect(installStyles, 'dsh-git: stylesheet');
    ctx.effect(() => installProjectBridge({
        connection: ctx.connection,
        sessions,
        workspaces: ctx.workspaces,
        locale: ctx.locale,
        repositoryForWorkspace: workspaceId => repositories.forWorkspace(workspaceId),
    }), 'dsh-git: project graph compatibility bridge');
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'dsh-git',
        order: 20,
        label: () => localized('分支', 'Branches'),
        inject: (sessionId) => {
            const repository = repositories.forSession(sessionId);
            const sessionParents = () => Object.fromEntries(Object.values(sessions.list.getSnapshot().byId).flatMap(item => item.parentId === undefined
                ? []
                : [[String(item.id), String(item.parentId)]]));
            repository.reconcileOfficialForks(sessionParents());
            return {
                hooks: { graph: repository },
                syncTurns: turns => {
                    repository.syncSession(sessionId, turns);
                    repository.reconcileOfficialForks(sessionParents());
                },
                toggleContext: nodeId => repository.toggleContext(nodeId),
                moveContext: (nodeId, beforeId) => repository.moveContext(nodeId, beforeId),
                moveContextToEnd: nodeId => repository.moveContextToEnd(nodeId),
                clearContext: () => repository.clearContext(),
                checkout: (nodeId) => {
                    const node = repository.getSnapshot().nodes[nodeId];
                    if (node !== undefined)
                        sessions.open(node.sessionId);
                },
                renameBranch: (branchId, branchName) => repository.renameBranch(branchId, branchName),
                ask: async (question, manifest) => {
                    const state = repository.getSnapshot();
                    const selected = manifest.flatMap(nodeId => state.nodes[nodeId] === undefined ? [] : [state.nodes[nodeId]]);
                    if (selected.length === 0)
                        throw new Error(localized('请先选择至少一个 PA 节点。', 'Select at least one PA node first.'));
                    const base = [...selected].sort((left, right) => left.createdAt - right.createdAt)[0];
                    const primaryParentId = state.headNodeId !== null && manifest.includes(state.headNodeId)
                        ? state.headNodeId
                        : manifest.at(-1) ?? null;
                    const source = sessions.binding(base.sessionId)?.session;
                    if (source === undefined)
                        throw new Error(localized('无法访问用于创建 merge branch 的来源 session。', 'Cannot access the source Session used to create the merge branch.'));
                    const childSessionId = createSessionId();
                    repositories.pinSession(childSessionId, repository);
                    const payload = encodeCreateMergedSessionPayload({
                        targetSessionId: childSessionId,
                        sources: selected.map(node => ({
                            sourceSessionId: node.sessionId,
                            sourceTurn: node.turn,
                            sourceBoundarySeq: node.boundarySeq,
                        })),
                    });
                    const command = await source.command(`/${CREATE_MERGED_SESSION_COMMAND} ${payload}`);
                    if (!command.ok)
                        throw new Error(localized(`创建 merge branch 失败：${command.error.message}`, `Failed to create merge branch: ${command.error.message}`));
                    if (!command.value.matched)
                        throw new Error(localized('Host 未加载 dsh-git 历史合成命令，请重启 dsh。', 'The Host did not load the dsh-git history composition command. Restart dsh.'));
                    repository.prepareBranch({
                        sourceSessionId: base.sessionId,
                        childSessionId,
                        baseNodeId: base.id,
                        importedNodeIds: manifest,
                        parentIds: manifest,
                        primaryParentId,
                        contextManifest: manifest,
                        prompt: question.trim(),
                    });
                    const binding = await waitForSession(sessions, childSessionId);
                    if (binding === undefined) {
                        repository.abortPending(childSessionId);
                        throw new Error(localized('新 branch 已在 Host 创建，但浏览器没有收到对应 session。', 'The new branch was created on the Host, but the browser did not receive its Session.'));
                    }
                    sessions.open(childSessionId);
                    const result = await binding.session.prompt([{ type: 'text', text: question.trim() }], 'queue');
                    if (!result.ok) {
                        repository.abortPending(childSessionId);
                        throw new Error(localized(`新 branch 提问失败：${result.error.message}`, `Failed to ask on the new branch: ${result.error.message}`));
                    }
                },
            };
        },
    }, GraphView));
}
//# sourceMappingURL=index.js.map