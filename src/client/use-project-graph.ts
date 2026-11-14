/** The Workspace graph as the Branches view sees it: read from the Host, laid over the ledger. */
import { useEffect, useMemo, useState } from 'react'
import type { ProjectGraphResponse } from '../protocol.ts'
import { assembleProjectGraph, type ProjectGraphModel } from './project-graph.ts'
import type { GraphState } from './types.ts'

/** One Workspace read: the Host's Sessions and turns, and the titles to show them under. */
export interface ProjectGraphLoad {
  readonly response: ProjectGraphResponse
  readonly sessionTitles: Readonly<Record<string, string>>
}

/** What the view knows about the Workspace graph at one render. */
export interface ProjectGraph {
  /** The assembled graph, or null before the first read and for a Chat outside every Workspace. */
  readonly model: ProjectGraphModel | null
  /** Why the last read failed, if it did. */
  readonly error: string | null
  /** Whether the first read has come back, with a graph or without. */
  readonly settled: boolean
}

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
export function useProjectGraph(
  sessionId: string,
  localState: GraphState,
  load: (signal: AbortSignal) => Promise<ProjectGraphLoad | null>,
  adopt: (state: GraphState) => void,
): ProjectGraph {
  const [project, setProject] = useState<ProjectGraphLoad | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    void load(controller.signal).then((loaded) => {
      if (controller.signal.aborted) return
      setProject(loaded)
      setSettled(true)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setSettled(true)
    })
    return () => controller.abort()
  }, [sessionId, load])

  const model = useMemo(() => project === null
    ? null
    : assembleProjectGraph(project.response, localState, project.sessionTitles), [project, localState])

  useEffect(() => {
    if (model !== null) adopt(model.state)
  }, [model, adopt])

  return { model, error, settled }
}
