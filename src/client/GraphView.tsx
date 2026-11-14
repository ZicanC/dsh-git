import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconPanelLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  HistoryPreviewImageAttachment, HistoryPreviewResponse, HistoryTurnSource, ProjectGraphResponse,
} from '../protocol.ts'
import { MAX_MERGED_HISTORY_TURNS } from '../protocol.ts'
import {
  ChatHistoryPreview, type LivePreviewTurn, type LoadedPreviewImage,
} from './ChatHistoryPreview.tsx'
import type { ContextTrayProps } from './ContextTray.tsx'
import type { ContextTrayChannel } from './context-tray-channel.ts'
import { GraphCanvas } from './GraphCanvas.tsx'
import { contextReferences, paIdentityId } from './graph.ts'
import { HistoryRail } from './HistoryRail.tsx'
import { historyRailModel } from './history-rail.ts'
import { PAContextWindow } from './PAContextWindow.tsx'
import type { GraphRepository } from './repository.ts'
import { extractCompletedTurns } from './extract.ts'
import { projectLiveTurns } from './live-turn.ts'
import { HistoryPreviewCache, previewSourceKey } from './preview-cache.ts'
import { nodeLabelMap } from './labels.ts'
import { assembleProjectGraph } from './project-graph.ts'
import { localized, useLocale } from './i18n.ts'
import type { AnchorModeState, GraphState, ImportedTurn, TurnNodeId } from './types.ts'

export interface ProjectGraphLoad {
  readonly response: ProjectGraphResponse
  readonly sessionTitles: Readonly<Record<string, string>>
}

export interface MergeDraftTransfer {
  readonly contextRefs?: readonly import('../graph-state.ts').ContextRef[]
  readonly text: string
  readonly draftRevision: number
  readonly attachmentIds: readonly DraftAttachmentId[]
  readonly hasStructuredReferences: boolean
}

/** Browser callbacks and observables supplied from the plugin apply closure. */
export interface GraphViewInjected {
  readonly persistenceError?: () => string | null
  /** Session-local bridge to the official composer input dock. */
  readonly tray: ContextTrayChannel
  readonly hooks: { graph: GraphRepository }
  readonly syncTurns: (turns: readonly ImportedTurn[]) => void
  readonly adoptObservedGraph: (state: GraphState) => void
  readonly loadProjectGraph: (signal: AbortSignal) => Promise<ProjectGraphLoad | null>
  readonly loadHistoryPreview: (
    sources: readonly HistoryTurnSource[], signal: AbortSignal,
  ) => Promise<HistoryPreviewResponse>
  readonly loadPreviewImage: (
    sourceSessionId: string, attachment: HistoryPreviewImageAttachment,
  ) => Promise<LoadedPreviewImage>
  /** Returns whether the composer is free after the requested lease change. */
  readonly setComposerBlocked: (blocked: boolean) => boolean
  readonly activateAnchor: (
    manifest: readonly TurnNodeId[], signal: AbortSignal,
  ) => Promise<AnchorModeState>
  readonly cancelAnchor: (signal: AbortSignal) => Promise<void>
  readonly createMergedSession: (
    manifest: readonly TurnNodeId[], draft: MergeDraftTransfer, signal: AbortSignal,
  ) => Promise<void>
}

function distinct(ids: readonly TurnNodeId[]): TurnNodeId[] {
  return [...new Set(ids)]
}

function sessionHistory(state: GraphState, sessionId: string): TurnNodeId[] {
  return distinct(Object.entries(state.sessionTurnRefs[sessionId] ?? {})
    .sort(([left], [right]) => Number(left) - Number(right))
    .flatMap(([, nodeId]) => state.nodes[nodeId] === undefined ? [] : [nodeId]))
}

function sameIds(left: readonly TurnNodeId[], right: readonly TurnNodeId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function sourceOf(state: GraphState, nodeId: TurnNodeId): HistoryTurnSource | null {
  const node = state.nodes[nodeId]
  return node === undefined ? null : {
    sourceSessionId: node.sessionId,
    sourceTurn: node.turn,
    sourceBoundarySeq: node.boundarySeq,
  }
}

function isAbort(cause: unknown, signal: AbortSignal): boolean {
  return signal.aborted
    || (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError')
}

/** Complete Branches workbench: graph selection, read-only history, and Merge. */
export function GraphView({
  sessionId, useChat, useInput, inputActions, useGraph, syncTurns,
  adoptObservedGraph, loadProjectGraph, loadHistoryPreview, loadPreviewImage,
  tray, setComposerBlocked, activateAnchor, cancelAnchor, createMergedSession, persistenceError,
}: ConvViewProps & InjectFace<GraphViewInjected>) {
  const locale = useLocale()
  // Narrow subscriptions: an assistant delta swaps only `partial`, so the
  // graph, the rail, and every settled Chat History section keep their
  // memoized render while the live tail streams.
  const nodes = useChat(value => value.legacy.nodes)
  const timeline = useChat(value => value.timeline)
  const partial = useChat(value => value.legacy.partial)
  const runningCalls = useChat(value => value.legacy.runningCalls)
  const input = useInput(value => value)
  const localState = useGraph((value: GraphState) => value)
  const turns = useMemo(
    () => extractCompletedTurns({ nodes, chat: { timeline } }), [nodes, timeline])
  const turnSignature = turns.map(turn => `${turn.turn}:${turn.boundarySeq}:${turn.answer.length}`).join('|')

  const [project, setProject] = useState<ProjectGraphLoad | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [projectSettled, setProjectSettled] = useState(false)
  const [selectionVia, setSelectionVia] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<TurnNodeId[]>([])
  const [baselineIds, setBaselineIds] = useState<TurnNodeId[]>([])
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [candidateId, setCandidateId] = useState<TurnNodeId | null>(null)
  // Where the dashed candidate sits in the previewed merge order; the user can
  // move it before deciding to add it, so it is not always the last entry.
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [inspectedId, setInspectedId] = useState<TurnNodeId | null>(null)
  const [graphOpen, setGraphOpen] = useState(true)
  const [activeTrailId, setActiveTrailId] = useState<TurnNodeId | null>(null)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [anchorBusy, setAnchorBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const mergeAbortRef = useRef<AbortController | null>(null)
  const anchorAbortRef = useRef<AbortController | null>(null)
  const trayOwnerRef = useRef<object>({})
  // A completed turn is immutable, so its records are cached for the lifetime
  // of this view and never re-read when the selection changes.
  const previewCacheRef = useRef(new HistoryPreviewCache())
  const previewInFlightRef = useRef(new Set<string>())
  const previewAbortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { mergeAbortRef.current?.abort() }, [])
  useEffect(() => () => { anchorAbortRef.current?.abort() }, [])
  useEffect(() => () => { previewAbortRef.current?.abort() }, [])

  useEffect(() => {
    const controller = new AbortController()
    setProjectError(null)
    void loadProjectGraph(controller.signal).then((loaded) => {
      if (controller.signal.aborted) return
      setProject(loaded)
      setProjectSettled(true)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setProjectError(cause instanceof Error ? cause.message : String(cause))
      setProjectSettled(true)
    })
    return () => controller.abort()
  }, [sessionId, loadProjectGraph])

  const projectModel = useMemo(() => project === null
    ? null
    : assembleProjectGraph(project.response, localState, project.sessionTitles), [project, localState])
  const state = projectModel?.state ?? localState
  const anchor = localState.anchors[String(sessionId)]
  const anchorActive = anchor !== undefined

  useEffect(() => {
    if (projectModel !== null) adoptObservedGraph(projectModel.state)
  }, [projectModel, adoptObservedGraph])

  // Declared after the adoption above, and held until the first Workspace
  // read has settled: the Workspace graph knows which of this Chat's turns
  // were copied from another Session, so adopting it first keeps those copies
  // from being numbered as PAs of their own. A failed or absent Workspace
  // read settles too, and the turns are then imported on their own.
  useEffect(() => {
    if (projectSettled) syncTurns(turns)
  }, [turnSignature, syncTurns, projectSettled])

  const currentSessionIds = useMemo(() => sessionHistory(state, String(sessionId)), [state, sessionId])
  const currentSessionKey = currentSessionIds.join('\u0000')
  useEffect(() => {
    if (selectionTouched) return
    setBaselineIds(currentSessionIds)
    setSelectedIds(currentSessionIds)
  }, [currentSessionKey, selectionTouched])

  useEffect(() => {
    if (anchor === undefined) return
    const fixed = anchor.nodeIds.filter(nodeId => state.nodes[nodeId] !== undefined)
    setSelectedIds(fixed)
    setCandidateId(null)
    setInspectedId(null)
    setSelectionTouched(true)
  }, [anchor, state.nodes])

  const sourcePathsChanged = baselineIds.some(id => selectionVia[id] !== undefined && selectionVia[id] !== String(sessionId))

  // A candidate that was only inspected and then closed is not a lasting edit.
  // Re-arm baseline following so a later official turn joins the blue history.
  useEffect(() => {
    if (selectionTouched && candidateId === null && sameIds(selectedIds, baselineIds) && !sourcePathsChanged) {
      setSelectionTouched(false)
    }
  }, [selectionTouched, candidateId, selectedIds, baselineIds, sourcePathsChanged])

  const labels = useMemo(() => nodeLabelMap(state), [state])
  const dirty = !anchorActive && (candidateId !== null || !sameIds(selectedIds, baselineIds) || sourcePathsChanged)
  const previewId = candidateId !== null && !selectedIds.includes(candidateId) ? candidateId : null
  const previewIndex = Math.min(Math.max(candidateIndex, 0), selectedIds.length)
  const orderedPreviewIds = useMemo(() => previewId === null
    ? selectedIds
    : [...selectedIds.slice(0, previewIndex), previewId, ...selectedIds.slice(previewIndex)],
  [selectedIds, previewId, previewIndex])
  // Keep the node label currency paired with the exact sources sent to the
  // Host. If a stale graph reference cannot resolve, filtering the pair
  // together prevents every later PA label from shifting by one.
  const selectionSources = Object.fromEntries(orderedPreviewIds.map(id => [id,
    selectionVia[id] ?? (currentSessionIds.includes(id) ? String(sessionId) : state.nodes[id]?.sessionId ?? ''),
  ]))
  const selectionRefs = contextReferences(state, orderedPreviewIds.filter(id => state.nodes[id] !== undefined), selectionSources)
  const previewEntries = useMemo(() => orderedPreviewIds.flatMap(nodeId => {
    const source = sourceOf(state, nodeId)
    return source === null ? [] : [{ nodeId, source }]
  }), [orderedPreviewIds, state])
  const previewNodeIds = useMemo(() => previewEntries.map(entry => entry.nodeId), [previewEntries])
  const previewKey = previewEntries.map(({ source }) =>
    `${source.sourceSessionId}:${source.sourceTurn}:${source.sourceBoundarySeq}`).join('|')

  // Only the Merge flight makes the official composer inert: the draft is being
  // transferred, and any edit during it aborts the transfer. A merely unmerged
  // Context keeps the composer typable — the composer-row guard refuses the
  // send gestures instead, so the draft can be written before the Merge.
  useEffect(() => {
    setComposerBlocked(busy || anchorBusy)
    return () => { setComposerBlocked(false) }
  }, [busy, anchorBusy, setComposerBlocked, locale])

  const overLimit = previewEntries.length > MAX_MERGED_HISTORY_TURNS

  // Only PAs this view has never read are requested, and a request in flight
  // is never cancelled by a later selection edit: its records stay valid for
  // whatever selection is current when they land. Removing a PA is therefore
  // pure local work, and re-adding one costs no Host round trip at all.
  useEffect(() => {
    const sources = previewEntries.map(entry => entry.source)
    if (sources.length === 0 || overLimit) {
      setPreviewLoading(false)
      setPreviewError(overLimit
        ? localized(
          `单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`,
          `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale,
        )
        : null)
      return
    }
    const inFlight = previewInFlightRef.current
    const missing = previewCacheRef.current.missing(sources)
      .filter(source => !inFlight.has(previewSourceKey(source)))
    if (missing.length === 0) {
      setPreviewLoading(inFlight.size > 0)
      if (inFlight.size === 0) setPreviewError(null)
      return
    }
    previewAbortRef.current ??= new AbortController()
    const signal = previewAbortRef.current.signal
    const keys = missing.map(previewSourceKey)
    for (const key of keys) inFlight.add(key)
    setPreviewLoading(true)
    setPreviewError(null)
    void loadHistoryPreview(missing, signal).then((response) => {
      if (signal.aborted) return
      previewCacheRef.current.absorb(response)
      setPreviewRevision(revision => revision + 1)
    }).catch((cause: unknown) => {
      if (signal.aborted) return
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      for (const key of keys) inFlight.delete(key)
      if (!signal.aborted) setPreviewLoading(inFlight.size > 0)
    })
  }, [previewKey, overLimit, loadHistoryPreview, locale])

  const preview = useMemo<HistoryPreviewResponse | null>(() => {
    if (previewEntries.length === 0 || overLimit) return null
    return previewCacheRef.current.assemble(previewEntries.map(entry => entry.source))
    // previewRevision republishes the assembly after a Host read lands.
  }, [previewEntries, overLimit, previewRevision])
  const pendingNodeIds = useMemo(() => new Set(previewEntries.flatMap(entry =>
    previewCacheRef.current.has(entry.source) ? [] : [entry.nodeId])),
  [previewEntries, previewRevision])

  // The graph only owns a turn once it closes, so everything after the last
  // registered turn is still being produced: that is exactly what the live
  // tail renders, straight from the official conversation snapshot.
  const registeredTurn = useMemo(() => Object.entries(state.sessionTurnRefs[String(sessionId)] ?? {})
    .reduce((highest, [turn, nodeId]) => state.nodes[nodeId] === undefined
      ? highest
      : Math.max(highest, Number(turn)), 0), [state, sessionId])
  const liveTurns = useMemo<readonly LivePreviewTurn[]>(() => projectLiveTurns({
    nodes,
    chat: { timeline },
    partial: partial ?? null,
    runningCalls: runningCalls ?? [],
  }, registeredTurn).map(turn => ({
    key: turn.key,
    label: localized(`第 ${turn.turn} 轮`, `Turn ${turn.turn}`, locale),
    sourceSessionId: String(sessionId),
    records: turn.records,
  })), [nodes, timeline, partial, runningCalls, registeredTurn, sessionId, locale])

  const inspect = (nodeId: TurnNodeId): void => {
    if (busy || anchorBusy || anchorActive) return
    setActionError(null)
    setInspectedId(nodeId)
  }

  const closeInspector = (): void => {
    const closingId = inspectedId
    if (candidateId === inspectedId) setCandidateId(null)
    setInspectedId(null)
    if (closingId !== null) {
      const trigger = [...document.querySelectorAll<HTMLButtonElement>('.dsh-git-tree-node')]
        .find(button => button.dataset.nodeId === closingId)
      trigger?.focus()
    }
  }

  // Stable identity: the rail is memoized, and a streaming delta must not
  // re-render it through a fresh callback.
  const jumpToHistory = useCallback((nodeId: TurnNodeId): void => {
    const target = document.getElementById(`dsh-git-history-${nodeId}`)
    if (target === null) return
    target.scrollIntoView({ block: 'start', inline: 'nearest' })
    target.focus({ preventScroll: true })
  }, [])

  const addCandidate = (): void => {
    if (busy || anchorBusy || anchorActive) return
    if (inspectedId === null || state.nodes[inspectedId] === undefined) return
    setSelectionVia(via => ({ ...via, [inspectedId]: state.nodes[inspectedId]!.sessionId }))
    // Inspecting is read-only. Only this explicit action changes Context.
    setSelectedIds((ids) => {
      const identityId = paIdentityId(state, inspectedId)
      const existingIndex = ids.findIndex(nodeId => paIdentityId(state, nodeId) === identityId)
      if (existingIndex < 0) return [...ids, inspectedId]
      if (ids[existingIndex] === inspectedId) return ids
      const next = [...ids]
      next[existingIndex] = inspectedId
      return next
    })
    setCandidateId(null)
    setSelectionTouched(true)
  }

  const remove = (nodeId: TurnNodeId): void => {
    if (busy || anchorBusy || anchorActive) return
    setSelectedIds(ids => ids.filter(id => id !== nodeId))
    if (inspectedId === nodeId) setInspectedId(null)
    if (candidateId === nodeId) setCandidateId(null)
    setSelectionTouched(true)
  }

  // Reordering runs over the previewed order, then splits back into the
  // committed selection and the candidate's place inside it.
  const commitOrder = (next: readonly TurnNodeId[]): void => {
    if (previewId !== null) setCandidateIndex(next.indexOf(previewId))
    setSelectedIds(next.filter(id => id !== previewId))
    setSelectionTouched(true)
  }

  const move = (nodeId: TurnNodeId, beforeId: TurnNodeId): void => {
    if (busy || anchorBusy || anchorActive) return
    if (nodeId === beforeId || !orderedPreviewIds.includes(nodeId)) return
    const next = orderedPreviewIds.filter(id => id !== nodeId)
    const index = next.indexOf(beforeId)
    if (index < 0) return
    next.splice(index, 0, nodeId)
    commitOrder(next)
  }

  const moveEnd = (nodeId: TurnNodeId): void => {
    if (busy || anchorBusy || anchorActive) return
    if (!orderedPreviewIds.includes(nodeId)) return
    commitOrder([...orderedPreviewIds.filter(id => id !== nodeId), nodeId])
  }

  const discard = (send: boolean): void => {
    const composerAvailable = setComposerBlocked(false)
    setSelectionVia({})
    setSelectedIds(currentSessionIds)
    setBaselineIds(currentSessionIds)
    setSelectionTouched(false)
    setCandidateId(null)
    setInspectedId(null)
    setActionError(send && !composerAvailable ? localized(
      '来源 Session 仍被其他系统条件阻塞；Context 更改已放弃，请解除阻塞后使用官方输入框发送。',
      'Another system condition still blocks the source Session. The context edits were discarded; resolve that block, then send with the official composer.', locale,
    ) : null)
    if (send && composerAvailable) inputActions.submit()
  }

  const merge = async (): Promise<void> => {
    if (busy || anchorBusy || anchorActive || selectedIds.length === 0 || candidateId !== null) return
    if (input.phase !== 'plain') {
      setActionError(localized(
        '官方输入框正在处理另一项操作；请等待输入状态稳定后再 Merge。',
        'The official composer is handling another operation. Wait for it to settle before merging.', locale,
      ))
      return
    }
    if (selectedIds.length > MAX_MERGED_HISTORY_TURNS) {
      setActionError(localized(
        `单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`,
        `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale,
      ))
      return
    }
    const controller = new AbortController()
    mergeAbortRef.current?.abort()
    mergeAbortRef.current = controller
    setBusy(true)
    setActionError(null)
    try {
      if (input.occurrences.length > 0) {
        throw new Error(localized(
          '输入草稿包含 @ 引用或其他结构化 chip；请先移除或转换为普通文本再 Merge。',
          'The draft contains @ references or other structured chips. Remove them or convert them to plain text before merging.', locale,
        ))
      }
      await createMergedSession(selectedIds, {
        contextRefs: contextReferences(state, selectedIds, selectionSources),
        text: input.draft,
        draftRevision: input.draftRev,
        attachmentIds: input.attachmentIds,
        hasStructuredReferences: false,
      }, controller.signal)
    } catch (cause: unknown) {
      if (!isAbort(cause, controller.signal)) {
        setActionError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (mergeAbortRef.current === controller) mergeAbortRef.current = null
      setBusy(false)
    }
  }

  const toggleAnchor = async (): Promise<void> => {
    if (busy || anchorBusy) return
    setActionError(null)
    if (anchorActive) {
      const controller = new AbortController()
      anchorAbortRef.current = controller
      setAnchorBusy(true)
      try {
        await cancelAnchor(controller.signal)
        setSelectedIds(currentSessionIds)
        setBaselineIds(currentSessionIds)
        setSelectionTouched(false)
        setCandidateId(null)
        setInspectedId(null)
      } catch (cause: unknown) {
        if (!isAbort(cause, controller.signal)) {
          setActionError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        if (anchorAbortRef.current === controller) anchorAbortRef.current = null
        setAnchorBusy(false)
      }
      return
    }
    if (candidateId !== null) {
      setActionError(localized(
        '请先加入或关闭绿色预览 PA，再固定锚点。',
        'Add or close the green preview PA before fixing the anchor.', locale,
      ))
      return
    }
    if (selectedIds.length === 0 || selectedIds.length > MAX_MERGED_HISTORY_TURNS) return
    const controller = new AbortController()
    anchorAbortRef.current?.abort()
    anchorAbortRef.current = controller
    setAnchorBusy(true)
    try {
      await activateAnchor(selectedIds, controller.signal)
    } catch (cause: unknown) {
      if (!isAbort(cause, controller.signal)) {
        setActionError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (anchorAbortRef.current === controller) anchorAbortRef.current = null
      setAnchorBusy(false)
    }
  }

  const inspected = inspectedId === null ? undefined : state.nodes[inspectedId]
  const inspectedSelected = inspectedId !== null && selectedIds.includes(inspectedId)
  // Memoized: the canvas re-lays out the whole tree whenever this object's
  // identity changes, which must not happen on every streamed delta.
  const canvasState = useMemo<GraphState>(() => ({
    ...state,
    headNodeId: baselineIds.at(-1) ?? state.headNodeId,
    contextManifest: [],
  }), [state, baselineIds])
  const rail = useMemo(() => historyRailModel(state, {
    selectedIds,
    candidateId,
    headNodeId: canvasState.headNodeId,
    orderedIds: previewNodeIds,
  }), [state, selectedIds, candidateId, canvasState.headNodeId, previewNodeIds])
  useEffect(() => {
    if (activeTrailId !== null && !previewNodeIds.includes(activeTrailId)) setActiveTrailId(null)
  }, [activeTrailId, previewNodeIds])
  const draftHasContent = input.draft.trim() !== '' || input.attachmentIds.length > 0
  const trayModel: ContextTrayProps = {
    state,
    contextRefs: selectionRefs,
    selectedIds,
    orderedIds: orderedPreviewIds,
    candidateId,
    busy: busy || anchorBusy,
    anchored: anchorActive,
    anchorWorkspaceTitle: anchor?.workspaceTitle,
    error: actionError,
    dirty,
    draftHasContent,
    overLimit: selectedIds.length > MAX_MERGED_HISTORY_TURNS,
    onMove: move,
    onMoveEnd: moveEnd,
    onRemove: remove,
    onMerge: merge,
    onDiscard: discard,
    onSendRefused: () => {
      setActionError(localized(
        'Context 尚未 Merge：官方输入框可以继续输入，但发送只能通过 Merge，或「放弃更改并发送」。',
        'The Context is unmerged: the composer still accepts text, but sending goes through Merge or “Discard changes and send”.', locale,
      ))
    },
  }

  // The Branches view owns all mutable selection state; the official input
  // dock only observes this committed view model. Publish after React commits
  // and clear only this mount's owner token when the tab is left.
  useLayoutEffect(() => {
    tray.publish(trayOwnerRef.current, trayModel)
  })
  useLayoutEffect(() => {
    const owner = trayOwnerRef.current
    return () => { tray.clear(owner) }
  }, [tray])

  return <div className="dsh-git-root" data-conversation-composer-overlay="">
    {persistenceError?.() ? <div className="dsh-git-error" role="alert">
      {localized('图账本尚未保存，请重新加载页面：', 'Graph changes are not saved. Reload the page: ', locale)}{persistenceError()}
    </div> : null}
    <div className={`dsh-git-workbench ${graphOpen ? '' : 'dsh-git-workbench-graph-closed'}`}>
      {graphOpen && <div
        id="dsh-git-conversation-graph"
        className={`dsh-git-branch-left ${inspected === undefined ? '' : 'dsh-git-branch-left-open'}`}
      >
        <section className="dsh-git-graph-panel" aria-label="Conversation Graph">
          <header className="dsh-git-heading">
            <span>Conversation Graph</span>
            <span className="dsh-git-legend">
              {projectError === null ? <>
                <span className="dsh-git-legend-bar" aria-hidden="true" />
                <span>{localized('已加入', 'Included', locale)}</span>
              </> : <span className="dsh-git-muted">{projectError}</span>}
              <button
                className="dsh-git-anchor-button"
                data-active={anchorActive ? '' : undefined}
                type="button"
                aria-pressed={anchorActive}
                disabled={anchorBusy || busy || (!anchorActive && (selectedIds.length === 0 || candidateId !== null))}
                title={anchorActive
                  ? localized(`取消锚点；「${anchor.workspaceTitle}」会保留，再次锚定同一组 PA 时继续使用`, `Cancel anchor; “${anchor.workspaceTitle}” is kept and reused when the same PAs are anchored again`, locale)
                  : localized('固定蓝色 PA，并创建隔离的并列问题 Workspace', 'Fix the blue PAs and create an isolated Workspace for parallel questions', locale)}
                onClick={() => { void toggleAnchor() }}
              >
                <span aria-hidden="true">⌖</span>
                {anchorBusy
                  ? localized('正在处理…', 'Working…', locale)
                  : anchorActive
                    ? localized(`已锚定 ${anchor.nodeIds.length}`, `${anchor.nodeIds.length} anchored`, locale)
                    : localized('锚定', 'Anchor', locale)}
              </button>
            </span>
          </header>
          <GraphCanvas
            state={canvasState}
            previewNodeId={inspectedId}
            selectedNodeIds={selectedIds}
            candidateNodeId={candidateId}
            anchoredNodeIds={anchor?.nodeIds}
            disabled={busy || anchorBusy || anchorActive}
            onPreview={inspect}
          />
        </section>
        {inspected === undefined || inspectedId === null ? null : <PAContextWindow
          state={state}
          nodeId={inspectedId}
          label={labels.get(inspectedId) ?? 'PA'}
          selected={inspectedSelected}
          disabled={busy || anchorBusy || anchorActive}
          onAdd={addCandidate}
          onRemove={() => remove(inspectedId)}
          onClose={closeInspector}
        />}
      </div>}
      <section className="dsh-git-chat-panel" aria-label="Chat History">
        <header className="dsh-git-heading">
          <span className="dsh-git-heading-title">
            <span>Chat History</span>
            <button
              className="dsh-git-graph-toggle"
              type="button"
              aria-controls="dsh-git-conversation-graph"
              aria-expanded={graphOpen}
              aria-label={graphOpen
                ? localized('关闭 Conversation Graph', 'Close Conversation Graph', locale)
                : localized('打开 Conversation Graph', 'Open Conversation Graph', locale)}
              onClick={() => setGraphOpen(open => !open)}
            >
              <IconPanelLeftOutlineRegular size={16} />
            </button>
          </span>
          <span className="dsh-git-muted">
            {selectedIds.length} {localized('已加入', 'included', locale)}
            {candidateId === null ? '' : localized(' + 1 预览', ' + 1 preview', locale)}
          </span>
        </header>
        <div className={`dsh-git-chat-body ${rail.entries.length === 0
          ? ''
          : graphOpen ? 'dsh-git-chat-body-rail' : 'dsh-git-chat-body-rail-expanded'}`}>
          <HistoryRail
            {...rail}
            disabled={busy || anchorBusy}
            expanded={!graphOpen}
            onSelect={jumpToHistory}
            onActiveChange={setActiveTrailId}
          />
          <ChatHistoryPreview
            response={preview}
            orderedNodeIds={previewNodeIds}
            labels={labels}
            candidateNodeId={candidateId}
            activeNodeId={activeTrailId}
            pendingNodeIds={pendingNodeIds}
            liveTurns={liveTurns}
            loading={previewLoading}
            error={previewError}
            loadImage={loadPreviewImage}
          />
        </div>
      </section>
    </div>
  </div>
}
