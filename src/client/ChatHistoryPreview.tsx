import {
  memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react'
import {
  DisclosureRow,
  IconApiOutline14,
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconThinkOutline14,
  JsonBlock,
  MarkdownText,
  MessageText,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HistoryPreviewContentBlock, HistoryPreviewImageAttachment, HistoryPreviewJsonValue,
  HistoryPreviewRecord, HistoryPreviewResponse,
} from '../protocol.ts'
import { localized, useLocale, type Locale } from './i18n.ts'
import type { TurnNodeId } from './types.ts'

export interface LoadedPreviewImage {
  readonly url: string
  readonly release: () => void
}

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
  readonly loadImage: (sourceSessionId: string, attachment: HistoryPreviewImageAttachment) => Promise<LoadedPreviewImage>
}

type UserRecord = Extract<HistoryPreviewRecord, { kind: 'user' }>
type ToolCallRecord = Extract<HistoryPreviewRecord, { kind: 'tool-call' }>
type ToolResultRecord = Extract<HistoryPreviewRecord, { kind: 'tool-result' }>

function json(value: HistoryPreviewJsonValue): string {
  try { return JSON.stringify(value, null, 2) }
  catch { return String(value) }
}

function oneLine(value: string, maximum = 180): string {
  const line = value.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line.length <= maximum ? line : `${line.slice(0, maximum - 1)}…`
}

function sourceKind(source: HistoryPreviewJsonValue): string | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null
  const record = source as { readonly [key: string]: HistoryPreviewJsonValue }
  return typeof record.kind === 'string' ? record.kind : null
}

function sourceRecord(value: HistoryPreviewJsonValue): { readonly [key: string]: HistoryPreviewJsonValue } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as { readonly [key: string]: HistoryPreviewJsonValue }
}

function sourceString(record: { readonly [key: string]: HistoryPreviewJsonValue }, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** Same durable-source projection used by the official Context Injection row. */
function previewContextProvenance(source: HistoryPreviewJsonValue): { role: 'inject' | 'recall'; label: string | null } {
  const record = sourceRecord(source)
  if (record === null) return { role: 'inject', label: null }
  const kind = sourceString(record, 'kind')
  if (kind === null) return { role: 'inject', label: null }
  const collect = (member: string, field: string): string[] => {
    const entries = record[member]
    if (!Array.isArray(entries)) return []
    const values: string[] = []
    for (const entry of entries) {
      const item = sourceRecord(entry)
      const value = item === null ? null : sourceString(item, field)
      if (value !== null && !values.includes(value)) values.push(value)
    }
    return values
  }
  if (kind === 'session-reference') {
    const labels = collect('references', 'label')
    return { role: 'recall', label: labels.length === 0 ? kind : labels.join(', ') }
  }
  if (kind === 'agent-instructions') {
    const paths = collect('changes', 'path')
    return { role: 'inject', label: paths.length === 0 ? kind : paths.join(', ') }
  }
  if (kind === 'plugin') return { role: 'inject', label: sourceString(record, 'plugin') ?? kind }
  if (kind === 'skill-invocation') return { role: 'inject', label: sourceString(record, 'name') ?? kind }
  return { role: 'inject', label: kind }
}

function firstBlockText(blocks: readonly HistoryPreviewContentBlock[]): string {
  for (const block of blocks) {
    if ((block.type === 'text' || block.type === 'reasoning') && block.text.trim() !== '') return oneLine(block.text)
    if (block.type === 'tool-result') {
      const nested = firstBlockText(block.content)
      if (nested !== '') return nested
    }
  }
  return ''
}

function argumentSummary(argumentsText: string): string {
  try {
    const parsed = JSON.parse(argumentsText) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return oneLine(String(parsed))
    const record = parsed as Record<string, unknown>
    for (const key of ['description', 'path', 'file_path', 'command', 'query', 'pattern', 'url', 'name']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') return oneLine(value)
    }
  } catch {
    // Tool arguments are producer-owned; malformed JSON stays readable as text.
  }
  return oneLine(argumentsText)
}

function formattedArguments(argumentsText: string): string {
  try { return JSON.stringify(JSON.parse(argumentsText), null, 2) }
  catch { return argumentsText }
}

function PreviewImage({
  sourceSessionId, attachment, load,
}: {
  readonly sourceSessionId: string
  readonly attachment: HistoryPreviewImageAttachment
  readonly load: ChatHistoryPreviewProps['loadImage']
}) {
  const [loaded, setLoaded] = useState<LoadedPreviewImage | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let resource: LoadedPreviewImage | null = null
    setLoaded(null)
    setFailed(false)
    void load(sourceSessionId, attachment).then((next) => {
      resource = next
      if (active) setLoaded(next)
      else next.release()
    }).catch(() => { if (active) setFailed(true) })
    return () => {
      active = false
      resource?.release()
    }
  }, [sourceSessionId, attachment.attachmentId, load])

  if (failed) return <span className="dsh-git-muted">{attachment.name ?? attachment.attachmentId}</span>
  if (loaded === null) return <span className="dsh-git-muted">{attachment.name ?? 'Image'}…</span>
  return <img className="dsh-git-preview-image" src={loaded.url} alt={attachment.name ?? 'Chat attachment'} />
}

function separator(): ReactNode {
  return <span className="dsh-git-preview-disclosure-separator" aria-hidden />
}

function ReasoningRow({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false)
  return <DisclosureRow
    className="dsh-git-preview-disclosure"
    icon={<IconThinkOutline14 size={14} />}
    title="Think"
    open={open}
    expandable
    expandOnRowClick
    keepContentWhenOpen
    onToggle={() => { setOpen(value => !value) }}
    collapsedContent={<>{separator()}<span className="dsh-git-preview-disclosure-summary">{oneLine(text)}</span></>}
  >
    <div className="dsh-git-preview-reasoning-body">{text}</div>
  </DisclosureRow>
}

function Blocks({
  blocks, sourceSessionId, loadImage, mode = 'assistant', hideToolCalls = false,
}: {
  readonly blocks: readonly HistoryPreviewContentBlock[]
  readonly sourceSessionId: string
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
  readonly mode?: 'assistant' | 'tool'
  readonly hideToolCalls?: boolean
}) {
  return <div className={`dsh-git-preview-blocks dsh-git-preview-blocks-${mode}`}>{blocks.map((block, index) => {
    const key = `${block.type}:${index}`
    switch (block.type) {
      case 'text':
        if (block.text === '') return null
        return mode === 'tool'
          ? <pre className="dsh-git-preview-tool-output" key={key}>{block.text}</pre>
          : <MarkdownText key={key} text={block.text} />
      case 'reasoning':
        return block.text === '' ? null : <ReasoningRow key={key} text={block.text} />
      case 'image':
        return <PreviewImage key={key} sourceSessionId={sourceSessionId} attachment={block.attachment} load={loadImage} />
      case 'tool-call':
        return hideToolCalls ? null : <pre className="dsh-git-preview-tool-output" key={key}>{block.arguments}</pre>
      case 'tool-result':
        return <Blocks
          key={key}
          blocks={block.content}
          sourceSessionId={sourceSessionId}
          loadImage={loadImage}
          mode="tool"
        />
      case 'other':
        return <JsonBlock
          key={key}
          label={block.originalType}
          payload={block.value}
          truncatedLabel={total => `… ${total}`}
        />
    }
  })}</div>
}

function UserMessage({
  record, sourceSessionId, loadImage, locale,
}: {
  readonly record: UserRecord
  readonly sourceSessionId: string
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
  readonly locale: Locale
}) {
  const text = record.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  const images = record.content.filter((block): block is Extract<HistoryPreviewContentBlock, { type: 'image' }> => block.type === 'image')
  const rest = record.content.filter(block => block.type !== 'text' && block.type !== 'image')
  return <div
    className="dsh-git-preview-user"
    role="article"
    aria-label={localized('用户消息', 'User message', locale)}
  >
    <div className="dsh-git-preview-user-stack">
      {images.length === 0 ? null : <div className="dsh-git-preview-user-images">
        {images.map((block, index) => <PreviewImage
          key={`${block.attachment.attachmentId}:${index}`}
          sourceSessionId={sourceSessionId}
          attachment={block.attachment}
          load={loadImage}
        />)}
      </div>}
      {text === '' && rest.length === 0 ? null : <div className="dsh-git-preview-user-bubble">
        {text === '' ? null : <MessageText text={text} />}
        {rest.map((block, index) => block.type === 'other'
          ? <JsonBlock key={index} label={block.originalType} payload={block.value} truncatedLabel={total => `… ${total}`} />
          : <pre className="dsh-git-preview-other" key={index}>{json(block as unknown as HistoryPreviewJsonValue)}</pre>)}
      </div>}
    </div>
  </div>
}

function ContextMessage({
  record, sourceSessionId, loadImage, locale,
}: {
  readonly record: UserRecord
  readonly sourceSessionId: string
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
  readonly locale: Locale
}) {
  const [open, setOpen] = useState(false)
  const provenance = previewContextProvenance(record.source)
  const summary = firstBlockText(record.content)
  const title = provenance.role === 'recall'
    ? localized('上下文回溯', 'Context recall', locale)
    : localized('上下文注入', 'Context injection', locale)
  return <DisclosureRow
    className="dsh-git-preview-disclosure dsh-git-preview-context"
    icon={<IconBrowseOutline16 size={14} />}
    title={title}
    open={open}
    expandable
    expandOnRowClick
    keepContentWhenOpen
    onToggle={() => { setOpen(value => !value) }}
    collapsedContent={<>
      {provenance.label === null ? null : <>{separator()}<span className="dsh-git-preview-disclosure-source">{provenance.label}</span></>}
      {summary === '' ? null : <>{separator()}<span className="dsh-git-preview-disclosure-summary">{summary}</span></>}
    </>}
  >
    <div className="dsh-git-preview-context-body">
      <Blocks blocks={record.content} sourceSessionId={sourceSessionId} loadImage={loadImage} mode="tool" />
    </div>
  </DisclosureRow>
}

function ToolRow({
  call, result, sourceSessionId, loadImage, locale,
}: {
  readonly call?: ToolCallRecord
  readonly result?: ToolResultRecord
  readonly sourceSessionId: string
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
  readonly locale: Locale
}) {
  const [open, setOpen] = useState(false)
  const failed = result?.isError === true
  const title = call?.name ?? localized('工具', 'Tool', locale)
  const summary = failed
    ? firstBlockText(result?.content ?? []) || localized('工具运行失败', 'Tool failed', locale)
    : argumentSummary(call?.arguments ?? '') || firstBlockText(result?.content ?? []) || localized('已完成', 'Done', locale)
  const expandable = call !== undefined || result !== undefined
  return <DisclosureRow
    className="dsh-git-preview-disclosure dsh-git-preview-tool-row"
    icon={failed ? <StateDot state="error" /> : <IconApiOutline14 size={14} />}
    title={title}
    open={open}
    expandable={expandable}
    expandOnRowClick
    keepContentWhenOpen
    onToggle={() => { setOpen(value => !value) }}
    collapsedContent={<>{separator()}<span className="dsh-git-preview-disclosure-summary" data-error={failed || undefined}>{summary}</span></>}
  >
    <div className="dsh-git-preview-tool-body" data-error={failed || undefined}>
      {call === undefined ? null : <section className="dsh-git-preview-tool-part">
        <span className="dsh-git-preview-tool-label">IN</span>
        <pre>{formattedArguments(call.arguments)}</pre>
      </section>}
      {result === undefined ? null : <section className="dsh-git-preview-tool-part">
        <span className="dsh-git-preview-tool-label">OUT</span>
        <div>
          <Blocks blocks={result.content} sourceSessionId={sourceSessionId} loadImage={loadImage} mode="tool" />
          {result.error === undefined ? null : <code className="dsh-git-preview-tool-error">{result.error.name} · {result.error.code}</code>}
        </div>
      </section>}
    </div>
  </DisclosureRow>
}

function StatusRecord({ record, locale }: {
  readonly record: Extract<HistoryPreviewRecord, { kind: 'turn-status' }>
  readonly locale: Locale
}) {
  const warning = record.status === 'max-tokens'
  return <div className="dsh-git-preview-status" role="status">
    <StateDot state={warning ? 'warning' : 'error'} />
    <strong>{warning
      ? localized('达到最大 token 数', 'Maximum tokens reached', locale)
      : localized('本轮未正常完成', 'Turn did not complete', locale)}</strong>
    <span>{record.status}</span>
  </div>
}

function EventRecord({ record }: {
  readonly record: Extract<HistoryPreviewRecord, { kind: 'event' }>
}) {
  const [open, setOpen] = useState(false)
  return <DisclosureRow
    className="dsh-git-preview-disclosure dsh-git-preview-event"
    icon={<IconApiOutline14 size={14} />}
    title={record.eventType}
    open={open}
    expandable
    expandOnRowClick
    onToggle={() => { setOpen(value => !value) }}
  >
    <div className="dsh-git-preview-context-body"><pre>{json(record.data)}</pre></div>
  </DisclosureRow>
}

function Record({
  record, sourceSessionId, loadImage, locale,
}: {
  readonly record: HistoryPreviewRecord
  readonly sourceSessionId: string
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
  readonly locale: Locale
}) {
  switch (record.kind) {
    case 'user':
      return sourceKind(record.source) === 'user'
        ? <UserMessage record={record} sourceSessionId={sourceSessionId} loadImage={loadImage} locale={locale} />
        : <ContextMessage record={record} sourceSessionId={sourceSessionId} loadImage={loadImage} locale={locale} />
    case 'assistant':
      return <div
        className="dsh-git-preview-assistant"
        role="article"
        aria-label={localized('Assistant 消息', 'Assistant message', locale)}
      >
        <Blocks blocks={record.blocks} sourceSessionId={sourceSessionId} loadImage={loadImage} hideToolCalls />
      </div>
    case 'tool-call':
      return <ToolRow call={record} sourceSessionId={sourceSessionId} loadImage={loadImage} locale={locale} />
    case 'tool-result':
      return <ToolRow result={record} sourceSessionId={sourceSessionId} loadImage={loadImage} locale={locale} />
    case 'turn-status':
      return <StatusRecord record={record} locale={locale} />
    case 'event':
      return <EventRecord record={record} />
    // request/header and request/context are model-call metadata. The official
    // Chat surface does not render them as conversation messages.
    case 'request':
      return null
  }
}

function TurnRecords({
  records, sourceSessionId, loadImage, locale,
}: {
  readonly records: readonly HistoryPreviewRecord[]
  readonly sourceSessionId: string
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
  readonly locale: Locale
}) {
  const calls = new Map<string, ToolCallRecord>()
  const results = new Map<string, ToolResultRecord>()
  for (const record of records) {
    if (record.kind === 'tool-call') calls.set(record.callId, record)
    if (record.kind === 'tool-result') results.set(record.callId, record)
  }
  return <div className="dsh-git-preview-flow">{records.map(record => {
    if (record.kind === 'request') return null
    if (record.kind === 'tool-call') {
      const result = results.get(record.callId)
      // Keyed by call identity alone: a streaming call keeps its row — and its
      // open/closed disclosure state — when its result finally lands.
      return <ToolRow
        key={`tool:${record.callId}`}
        call={record}
        {...result === undefined ? {} : { result }}
        sourceSessionId={sourceSessionId}
        loadImage={loadImage}
        locale={locale}
      />
    }
    if (record.kind === 'tool-result' && calls.has(record.callId)) return null
    return <Record
      key={`${record.kind}:${record.seq}`}
      record={record}
      sourceSessionId={sourceSessionId}
      loadImage={loadImage}
      locale={locale}
    />
  })}</div>
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
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
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
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  // Keeps the memoized sections memoized: the injected loader is rebuilt by
  // the plugin face, this identity never is.
  const loadImageRef = useRef(loadImage)
  loadImageRef.current = loadImage
  const stableLoadImage = useCallback<ChatHistoryPreviewProps['loadImage']>(
    (sourceSessionId, attachment) => loadImageRef.current(sourceSessionId, attachment), [])

  const scrollToBottom = () => {
    const element = scrollRef.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
  }

  useLayoutEffect(() => {
    if (response !== null && atBottomRef.current) scrollToBottom()
  }, [response])

  // Streaming grows the flow token by token, well below the render cadence a
  // response-keyed effect can see. Follow the measured column instead, and
  // only while the reader is still pinned to the floor.
  useEffect(() => {
    const column = columnRef.current
    const element = scrollRef.current
    if (column === null || element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(column)
    return () => { observer.disconnect() }
  }, [])

  const live = liveTurns ?? []
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
    ref={scrollRef}
    onScroll={(event) => {
      const element = event.currentTarget
      const next = element.scrollHeight - element.scrollTop - element.clientHeight <= 25
      atBottomRef.current = next
      setAtBottom(next)
    }}
  >
    <div className="dsh-git-preview-column" ref={columnRef}>
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
        <IconChevronDownOutline14 size={14} />
      </button>
    </div>}
  </div>
}
