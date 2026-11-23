/** The Workspace graph as the Branches view sees it: read from the Host, laid over the ledger. */
import { useEffect, useMemo, useState } from 'react';
import { assembleProjectGraph } from "./project-graph.js";
/**
 * Read the Workspace graph for a Chat and hand each assembly to the ledger.
 *
 * The Host's reply is frozen at the moment of the read, so it is assembled
 * again over every later ledger snapshot: turns completed since then stay
 * visible. The adoption effect is declared here, before any effect of the
 * caller that follows this hook — callers rely on that order.
 * @param load - resolves null for a Chat that belongs to no Workspace.
 * @param adopt - takes each assembled graph into the ledger.
 */
export function useProjectGraph(sessionId, localState, load, adopt) {
    const [project, setProject] = useState(null);
    const [error, setError] = useState(null);
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        setError(null);
        void load(controller.signal).then((loaded) => {
            if (controller.signal.aborted)
                return;
            setProject(loaded);
            setSettled(true);
        }).catch((cause) => {
            if (controller.signal.aborted)
                return;
            setError(cause instanceof Error ? cause.message : String(cause));
            setSettled(true);
        });
        return () => controller.abort();
    }, [sessionId, load]);
    const model = useMemo(() => project === null
        ? null
        : assembleProjectGraph(project.response, localState, project.sessionTitles), [project, localState]);
    useEffect(() => {
        if (model !== null)
            adopt(model.state);
    }, [model, adopt]);
    return { model, error, settled };
}
//# sourceMappingURL=use-project-graph.js.map