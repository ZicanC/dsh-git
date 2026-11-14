import { localized } from "./i18n.js";
import { restoreAnchorSourceLabels } from "./project-graph.js";
/** Display titles of every Session the browser lists, by Session id. */
export function sessionTitles(sessions) {
    const snapshot = sessions.list.getSnapshot();
    return Object.fromEntries(snapshot.ids.flatMap(id => {
        const item = snapshot.byId[id];
        return item === undefined ? [] : [[String(id), item.displayTitle]];
    }));
}
/**
 * Read a Workspace's Sessions and their completed turns from the Host.
 *
 * Anchor Sessions written before the merge lineage carried labels get them
 * back from the ledger of the Session each PA came from.
 * @param repositoryForSession - the ledger a Session belongs to.
 * @throws when the Host refuses, or answers for another Workspace.
 */
export async function readWorkspaceGraph(rpc, repositoryForSession, workspaceId, signal) {
    const response = await rpc.readProjectGraph(workspaceId, signal);
    if (response.workspaceId !== workspaceId) {
        throw new Error(localized('Host 返回了错误的 Workspace graph。', 'The Host returned a graph for the wrong Workspace.'));
    }
    const sourceIds = new Set(response.sessions.flatMap(item => item.mergeSources?.flatMap(source => source.sourceLabel === undefined
        ? [source.sourceSessionId]
        : []) ?? []));
    const sourceStates = new Map();
    for (const sourceSessionId of sourceIds) {
        const sourceRepository = repositoryForSession(sourceSessionId);
        await sourceRepository.hydrate();
        sourceStates.set(sourceSessionId, sourceRepository.getSnapshot());
    }
    return restoreAnchorSourceLabels(response, sourceStates);
}
//# sourceMappingURL=workspace-graph.js.map