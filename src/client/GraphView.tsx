import { useEffect, useMemo, useRef, useState } from 'react'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  HistoryPreviewImageAttachment, HistoryPreviewResponse, HistoryTurnSource, ProjectGraphResponse,
} from '../protocol.ts'
import { MAX_MERGED_HISTORY_TURNS } from '../protocol.ts'
import { ChatHistoryPreview, type LoadedPreviewImage } from './ChatHistoryPreview.tsx'
import { ContextTray } from './ContextTray.tsx'
import { GraphCanvas } from './GraphCanvas.tsx'
import { PAContextWindow } from './PAContextWindow.tsx'
import type { GraphRepository } from './repository.ts'
import { extractCompletedTurns } from './extract.ts'
import { nodeLabelMap } from './labels.ts'
import { assembleProjectGraph } from './project-graph.ts'
import { localized, useLocale } from './i18n.ts'
import type { GraphState, ImportedTurn, TurnNodeId } from './types.ts'

export interface ProjectGraphLoad {
  readonly response: ProjectGraphResponse
  readonly sessionTitles: Readonly<Record<string, string>>
}

export interface MergeDraftTransfer {
  readonly text: string
  readonly draftRevision: number
  readonly imageIds: readonly DraftAttachmentId[]
  readonly hasStructuredReferences: boolean
}

/** Browser callbacks and observables supplied from the plugin apply closure. */
export interface GraphViewInjected {
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
  sessionId, useSession, useInput, inputActions, useGraph, syncTurns,
  adoptObservedGraph, loadProjectGraph, loadHistoryPreview, loadPreviewImage,
  setComposerBlocked, createMergedSession,
}: ConvViewProps & InjectFace<GraphViewInjected>) {
  const locale = useLocale()
  const snapshot = useSession(value => value)
  const input = useInput(value => value)
  const localState = useGraph((value: GraphState) => value)
  const turns = useMemo(() => extractCompletedTurns(snapshot), [snapshot])
  const turnSignature = turns.map(turn => `${turn.turn}:${turn.boundarySeq}:${turn.answer.length}`).join('|')

  const [project, setProject] = useState<ProjectGraphLoad | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<TurnNodeId[]>([])
  const [baselineIds, setBaselineIds] = useState<TurnNodeId[]>([])
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [candidateId, setCandidateId] = useState<TurnNodeId | null>(null)
  const [inspectedId, setInspectedId] = useState<TurnNodeId | null>(null)
  const [preview, setPreview] = useState<HistoryPreviewResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const mergeAbortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { mergeAbortRef.current?.abort() }, [])

  useEffect(() => { syncTurns(turns) }, [turnSignature, syncTurns])

  useEffect(() => {
    const controller = new AbortController()
    setProjectError(null)
    void loadProjectGraph(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setProject(loaded)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setProjectError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => controller.abort()
  }, [sessionId, loadProjectGraph])

  const projectModel = useMemo(() => project === null
    ? null
    : assembleProjectGraph(project.response, localState, project.sessionTitles), [project, localState])
  const state = projectModel?.state ?? localState

  useEffect(() => {
    if (projectModel !== null) adoptObservedGraph(projectModel.state)
  }, [projectModel, adoptObservedGraph])

  const currentSessionIds = useMemo(() => sessionHistory(state, String(sessionId)), [state, sessionId])
  const currentSessionKey = currentSessionIds.join('\u0000')
  useEffect(() => {
    if (selectionTouched) return
    setBaselineIds(currentSessionIds)
    setSelectedIds(currentSessionIds)
  }, [currentSessionKey, selectionTouched])

  // A candidate that was only inspected and then closed is not a lasting edit.
  // Re-arm baseline following so a later official turn joins the blue history.
  useEffect(() => {
    if (selectionTouched && candidateId === null && sameIds(selectedIds, baselineIds)) {
      setSelectionTouched(false)
    }
  }, [selectionTouched, candidateId, selectedIds, baselineIds])

  const labels = useMemo(() => nodeLabelMap(state), [state])
  const dirty = candidateId !== null || !sameIds(selectedIds, baselineIds)
  const orderedPreviewIds = useMemo(() => candidateId === null || selectedIds.includes(candidateId)
    ? selectedIds
    : [...selectedIds, candidateId], [selectedIds, candidateId])
  const previewKey = orderedPreviewIds.map(nodeId => {
    const source = sourceOf(state, nodeId)
    return source === null ? `missing:${nodeId}` : `${source.sourceSessionId}:${source.sourceTurn}:${source.sourceBoundarySeq}`
  }).join('|')

  const composerBlocked = dirty || busy
  useEffect(() => {
    setComposerBlocked(composerBlocked)
    return () => { setComposerBlocked(false) }
  }, [composerBlocked, setComposerBlocked, locale])

  useEffect(() => {
    const sources = orderedPreviewIds.flatMap(nodeId => {
      const source = sourceOf(state, nodeId)
      return source === null ? [] : [source]
    })
    if (sources.length === 0) {
      setPreview(null)
      setPreviewLoading(false)
      setPreviewError(null)
      return
    }
    if (sources.length > MAX_MERGED_HISTORY_TURNS) {
      setPreview(null)
      setPreviewLoading(false)
      setPreviewError(localized(
        `单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`,
        `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale,
      ))
      return
    }
    const controller = new AbortController()
    setPreview(null)
    setPreviewLoading(true)
    setPreviewError(null)
    void loadHistoryPreview(sources, controller.signal).then((response) => {
      if (controller.signal.aborted) return
      setPreview(response)
      setPreviewLoading(false)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setPreviewError(cause instanceof Error ? cause.message : String(cause))
      setPreviewLoading(false)
    })
    return () => controller.abort()
  }, [previewKey, loadHistoryPreview, locale])

  const inspect = (nodeId: TurnNodeId): void => {
    if (busy) return
    setActionError(null)
    setInspectedId(nodeId)
    if (selectedIds.includes(nodeId)) {
      setCandidateId(null)
      return
    }
    setCandidateId(nodeId)
    setSelectionTouched(true)
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

  const addCandidate = (): void => {
    if (busy) return
    if (candidateId === null || state.nodes[candidateId] === undefined) return
    setSelectedIds(ids => ids.includes(candidateId) ? ids : [...ids, candidateId])
    setCandidateId(null)
    setSelectionTouched(true)
  }

  const remove = (nodeId: TurnNodeId): void => {
    if (busy) return
    setSelectedIds(ids => ids.filter(id => id !== nodeId))
    if (inspectedId === nodeId) setInspectedId(null)
    if (candidateId === nodeId) setCandidateId(null)
    setSelectionTouched(true)
  }

  const move = (nodeId: TurnNodeId, beforeId: TurnNodeId): void => {
    if (busy) return
    setSelectedIds(ids => {
      if (nodeId === beforeId || !ids.includes(nodeId)) return ids
      const next = ids.filter(id => id !== nodeId)
      const index = next.indexOf(beforeId)
      if (index < 0) return ids
      next.splice(index, 0, nodeId)
      return next
    })
    setSelectionTouched(true)
  }

  const moveEnd = (nodeId: TurnNodeId): void => {
    if (busy) return
    setSelectedIds(ids => ids.includes(nodeId) ? [...ids.filter(id => id !== nodeId), nodeId] : ids)
    setSelectionTouched(true)
  }

  const discard = (send: boolean): void => {
    const composerAvailable = setComposerBlocked(false)
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
    if (busy || selectedIds.length === 0 || candidateId !== null) return
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
        text: input.draft,
        draftRevision: input.draftRev,
        imageIds: input.imageIds,
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

  const inspected = inspectedId === null ? undefined : state.nodes[inspectedId]
  const inspectedSelected = inspectedId !== null && selectedIds.includes(inspectedId)
  const canvasState: GraphState = {
    ...state,
    headNodeId: baselineIds.at(-1) ?? state.headNodeId,
    contextManifest: [],
  }
  const draftHasContent = input.draft.trim() !== '' || input.imageIds.length > 0

  return <div className="dsh-git-root" data-conversation-composer-overlay="">
    <div className="dsh-git-workbench">
      <div className={`dsh-git-branch-left ${inspected === undefined ? '' : 'dsh-git-branch-left-open'}`}>
        <section className="dsh-git-graph-panel" aria-label="Conversation Graph">
          <header className="dsh-git-heading">
            <span>Conversation Graph</span>
            <span className="dsh-git-muted">{projectError ?? localized('蓝色：已加入 · 绿色：预览', 'Blue: included · green: preview', locale)}</span>
          </header>
          <GraphCanvas
            state={canvasState}
            previewNodeId={inspectedId}
            selectedNodeIds={selectedIds}
            candidateNodeId={candidateId}
            disabled={busy}
            onPreview={inspect}
          />
        </section>
        {inspected === undefined || inspectedId === null ? null : <PAContextWindow
          state={state}
          nodeId={inspectedId}
          label={labels.get(inspectedId) ?? 'PA'}
          selected={inspectedSelected}
          disabled={busy}
          onAdd={addCandidate}
          onRemove={() => remove(inspectedId)}
          onClose={closeInspector}
        />}
      </div>
      <section className="dsh-git-chat-panel" aria-label="Chat History">
        <header className="dsh-git-heading">
          <span>Chat History</span>
          <span className="dsh-git-muted">
            {selectedIds.length} {localized('已加入', 'included', locale)}
            {candidateId === null ? '' : localized(' + 1 预览', ' + 1 preview', locale)}
          </span>
        </header>
        <ChatHistoryPreview
          response={preview}
          orderedNodeIds={orderedPreviewIds}
          labels={labels}
          candidateNodeId={candidateId}
          loading={previewLoading}
          error={previewError}
          loadImage={loadPreviewImage}
        />
      </section>
    </div>
    <ContextTray
      state={state}
      selectedIds={selectedIds}
      candidateId={candidateId}
      busy={busy}
      error={actionError}
      dirty={dirty}
      draftHasContent={draftHasContent}
      overLimit={selectedIds.length > MAX_MERGED_HISTORY_TURNS}
      onMove={move}
      onMoveEnd={moveEnd}
      onRemove={remove}
      onClear={() => { setSelectedIds([]); setCandidateId(null); setInspectedId(null); setSelectionTouched(true) }}
      onMerge={merge}
      onDiscard={discard}
    />
  </div>
}
