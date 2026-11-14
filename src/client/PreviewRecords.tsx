/** Row components of the Chat History preview: one per kind of projected log record. */
import { useEffect, useState, type ReactNode } from 'react'
import {
  DisclosureRow,
  IconApiOutlineRegular,
  IconBrowseOutlineRegular,
  IconThinkOutlineRegular,
  JsonBlock,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HistoryPreviewContentBlock, HistoryPreviewImageAttachment, HistoryPreviewJsonValue,
  HistoryPreviewRecord,
} from '../protocol.ts'
import { localized, type Locale } from './i18n.ts'
import { PreviewMarkdown } from './PreviewMarkdown.tsx'
import {
  argumentSummary, firstBlockText, formattedArguments, json, oneLine, previewContextProvenance, sourceKind,
} from './preview-text.ts'

/** An image read from its source Session, with the handle that frees it. */
export interface LoadedPreviewImage {
  readonly url: string
  readonly release: () => void
}

/** Reads one attachment of a previewed turn from the Session that owns it. */
export type LoadPreviewImage = (
  sourceSessionId: string, attachment: HistoryPreviewImageAttachment,
) => Promise<LoadedPreviewImage>

type UserRecord = Extract<HistoryPreviewRecord, { kind: 'user' }>
type ToolCallRecord = Extract<HistoryPreviewRecord, { kind: 'tool-call' }>
type ToolResultRecord = Extract<HistoryPreviewRecord, { kind: 'tool-result' }>

function PreviewImage({
  sourceSessionId, attachment, load,
}: {
  readonly sourceSessionId: string
  readonly attachment: HistoryPreviewImageAttachment
  readonly load: LoadPreviewImage
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

/** Thin divider between the parts of a one-line row. */
export function separator(): ReactNode {
  return <span className="dsh-git-preview-disclosure-separator" aria-hidden />
}

function ReasoningRow({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false)
  return <DisclosureRow
    className="dsh-git-preview-disclosure"
    icon={<IconThinkOutlineRegular size={14} />}
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
  readonly loadImage: LoadPreviewImage
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
          : <PreviewMarkdown key={key} text={block.text} />
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
  readonly loadImage: LoadPreviewImage
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
        {text === '' ? null : <div className="dsh-git-preview-user-text">{text}</div>}
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
  readonly loadImage: LoadPreviewImage
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
    icon={<IconBrowseOutlineRegular size={14} />}
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
  readonly loadImage: LoadPreviewImage
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
    icon={failed ? <StateDot state="error" /> : <IconApiOutlineRegular size={14} />}
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
    icon={<IconApiOutlineRegular size={14} />}
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
  readonly loadImage: LoadPreviewImage
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

/** Every record of one turn in log order, with each tool call paired to its result. */
export function TurnRecords({
  records, sourceSessionId, loadImage, locale,
}: {
  readonly records: readonly HistoryPreviewRecord[]
  readonly sourceSessionId: string
  readonly loadImage: LoadPreviewImage
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
