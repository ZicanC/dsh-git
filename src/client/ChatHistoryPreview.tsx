import {
  memo, useCallback, useLayoutEffect, useRef,
} from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HistoryPreviewRecord, HistoryPreviewResponse } from '../protocol.ts'
import { localized, useLocale, type Locale } from './i18n.ts'
import { TurnRecords, separator, type LoadPreviewImage } from './PreviewRecords.tsx'
import { useStickToBottom } from './stick-to-bottom.ts'
import type { TurnNodeId } from './types.ts'

export type { LoadedPreviewImage } from './PreviewRecords.tsx'

/** One turn the official Chat is still producing, below the merged sections. */
export interface LivePreviewTurn {
  readonly key: string
  readonly label: string
  /** Session the streaming attachments resolve against. */
  readonly sourceSessionId: string
  readonly records: readonly HistoryPreviewRecord[]
}

export interface ChatHistoryPreviewProps {
  readonly response: HistoryPreviewResponse | null
  readonly orderedNodeIds: readonly TurnNodeId[]
  readonly labels: ReadonlyMap<TurnNodeId, string>
  readonly candidateNodeId: TurnNodeId | null
  /** PA currently stretched open in the adjacent conversation rail. */
  readonly activeNodeId?: TurnNodeId | null
  /** Selected PAs whose records have not arrived from the Host yet. */
  readonly pendingNodeIds?: ReadonlySet<TurnNodeId>
  /** Turns streaming in the source Session, not yet merged into the graph. */
  readonly liveTurns?: readonly LivePreviewTurn[]
  readonly loading: boolean
  readonly error: string | null
  readonly loadImage: LoadPreviewImage
}

/**
 * One rendered turn.
 *
 * Memoized on its own record list: the Host projection of a settled PA is
 * frozen and cached, so a streaming tail, a selection edit elsewhere, or a
 * rail hover re-renders only the section that actually changed — the same
 * per-row economics the official chat gets from its keyed node seats.
 */
const TurnSection = memo(function TurnSection({
  records, sourceSessionId, loadImage, locale, nodeId, label, stateLabel, state,
  railActive, pending,
}: {
  readonly records: readonly HistoryPreviewRecord[]
  readonly sourceSessionId: string
  readonly loadImage: LoadPreviewImage
  readonly locale: Locale
  readonly nodeId?: TurnNodeId
  readonly label: string
  readonly stateLabel: string
  readonly state: 'selected' | 'candidate' | 'live'
  readonly railActive: boolean
  readonly pending: boolean
}) {
  return <section
    className="dsh-git-preview-turn"
    id={nodeId === undefined ? undefined : `dsh-git-history-${nodeId}`}
    data-node-id={nodeId}
    data-preview-state={state}
    tabIndex={-1}
    aria-label={`${label} · ${stateLabel}`}
    aria-busy={pending || undefined}
    data-rail-active={railActive ? '' : undefined}
  >
    <header className="dsh-git-preview-turn-head">
      <strong>{label}</strong>
      {separator()}
      <span>{stateLabel}</span>
    </header>
    {pending && records.length === 0
      ? <div className="dsh-git-muted" role="status">{localized('正在读取该 PA…', 'Loading this PA…', locale)}</div>
      : <TurnRecords
        records={records}
        sourceSessionId={sourceSessionId}
        loadImage={loadImage}
        locale={locale}
      />}
  </section>
})

/** Read-only, official-style projection of the exact turns a Merge will seed. */
export function ChatHistoryPreview({
  response, orderedNodeIds, labels, candidateNodeId, activeNodeId = null,
  pendingNodeIds, liveTurns, loading, error, loadImage,
}: ChatHistoryPreviewProps) {
  const locale = useLocale()
  // Keeps the memoized sections memoized: the injected loader is rebuilt by
  // the plugin face, this identity never is.
  const loadImageRef = useRef(loadImage)
  loadImageRef.current = loadImage
  const stableLoadImage = useCallback<LoadPreviewImage>(
    (sourceSessionId, attachment) => loadImageRef.current(sourceSessionId, attachment), [])

  const { attachScroller, attachColumn, atBottom, pinned, scrollToBottom, onScroll } = useStickToBottom()

  const live = liveTurns ?? []
  // A live turn the official Chat just opened is content the reader submitted
  // themselves: land on it, even if they had scrolled up to read history. Keyed
  // on the tail turn alone, so the rest of its stream never yanks the viewport
  // back once they scroll away.
  const liveTailKey = live.length === 0 ? null : live[live.length - 1]?.key ?? null
  useLayoutEffect(() => {
    if (liveTailKey !== null) scrollToBottom()
  }, [liveTailKey, scrollToBottom])

  useLayoutEffect(() => {
    if (response !== null && pinned()) scrollToBottom()
  }, [response, scrollToBottom])

  if (loading && response === null && live.length === 0) {
    return <div className="dsh-git-chat-status" role="status">{localized('正在读取完整 Chat History…', 'Loading complete Chat History…', locale)}</div>
  }
  if (error !== null && response === null && live.length === 0) {
    return <div className="dsh-git-chat-status dsh-git-error" role="alert">{error}</div>
  }
  if ((response === null || response.turns.length === 0) && live.length === 0) {
    return <div className="dsh-git-chat-status">{localized('选择 PA 后，这里会显示合并后的聊天记录。', 'Select PAs to preview the merged chat history.', locale)}</div>
  }

  return <div
    className="dsh-git-chat-history"
    aria-busy={loading || undefined}
    ref={attachScroller}
    onScroll={onScroll}
  >
    <div className="dsh-git-preview-column" ref={attachColumn}>
      {(response?.turns ?? []).map((turn, index) => {
        const nodeId = orderedNodeIds[index]
        const candidate = nodeId !== undefined && nodeId === candidateNodeId
        const label = nodeId === undefined ? `PA${turn.targetTurn}` : labels.get(nodeId) ?? `PA${turn.targetTurn}`
        const pending = nodeId !== undefined && pendingNodeIds?.has(nodeId) === true
        const stateLabel = candidate
          ? localized('虚线预览', 'dashed preview', locale)
          : localized('已加入', 'included', locale)
        return <TurnSection
          key={`${turn.source.sourceSessionId}:${turn.source.sourceTurn}:${turn.source.sourceBoundarySeq}`}
          records={turn.records}
          sourceSessionId={turn.source.sourceSessionId}
          loadImage={stableLoadImage}
          locale={locale}
          {...nodeId === undefined ? {} : { nodeId }}
          label={label}
          stateLabel={stateLabel}
          state={candidate ? 'candidate' : 'selected'}
          railActive={nodeId !== undefined && nodeId === activeNodeId}
          pending={pending}
        />
      })}
      {live.map(turn => <TurnSection
        key={turn.key}
        records={turn.records}
        sourceSessionId={turn.sourceSessionId}
        loadImage={stableLoadImage}
        locale={locale}
        label={turn.label}
        stateLabel={localized('生成中', 'streaming', locale)}
        state="live"
        railActive={false}
        pending={false}
      />)}
      {loading ? <div className="dsh-git-muted" role="status">{localized('正在更新预览…', 'Updating preview…', locale)}</div> : null}
      {error === null ? null : <div className="dsh-git-error" role="alert">{error}</div>}
    </div>
    {atBottom ? null : <div className="dsh-git-preview-to-bottom-slot">
      <button
        type="button"
        className="dsh-git-preview-to-bottom"
        aria-label={localized('回到底部', 'Back to bottom', locale)}
        onClick={scrollToBottom}
      >
        <IconChevronDownOutlineRegular size={14} />
      </button>
    </div>}
  </div>
}
