import { useEffect, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HistoryPreviewContentBlock, HistoryPreviewImageAttachment, HistoryPreviewJsonValue,
  HistoryPreviewRecord, HistoryPreviewResponse,
} from '../protocol.ts'
import { localized, useLocale } from './i18n.ts'
import type { TurnNodeId } from './types.ts'

export interface LoadedPreviewImage {
  readonly url: string
  readonly release: () => void
}

export interface ChatHistoryPreviewProps {
  readonly response: HistoryPreviewResponse | null
  readonly orderedNodeIds: readonly TurnNodeId[]
  readonly labels: ReadonlyMap<TurnNodeId, string>
  readonly candidateNodeId: TurnNodeId | null
  readonly loading: boolean
  readonly error: string | null
  readonly loadImage: (sourceSessionId: string, attachment: HistoryPreviewImageAttachment) => Promise<LoadedPreviewImage>
}

function json(value: HistoryPreviewJsonValue): string {
  try { return JSON.stringify(value, null, 2) }
  catch { return String(value) }
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

function Blocks({
  blocks, sourceSessionId, loadImage, hideToolCalls = false,
}: {
  readonly blocks: readonly HistoryPreviewContentBlock[]
  readonly sourceSessionId: string
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
  readonly hideToolCalls?: boolean
}) {
  return <div className="dsh-git-preview-blocks">{blocks.map((block, index) => {
    const key = `${block.type}:${index}`
    switch (block.type) {
      case 'text':
        return block.text === '' ? null : <MarkdownText key={key} text={block.text} />
      case 'reasoning':
        return block.text === '' ? null : <section className="dsh-git-preview-reasoning" key={key}>
          <strong>Think</strong>
          <MarkdownText text={block.text} />
        </section>
      case 'image':
        return <PreviewImage key={key} sourceSessionId={sourceSessionId} attachment={block.attachment} load={loadImage} />
      case 'tool-call':
        return hideToolCalls ? null : <section className="dsh-git-preview-tool" key={key}>
          <header><span>{block.name}</span><code>{block.callId}</code></header>
          <pre>{block.arguments}</pre>
        </section>
      case 'tool-result':
        return <section className="dsh-git-preview-tool" key={key}>
          <header><span>{block.isError ? 'Tool error' : 'Tool result'}</span><code>{block.callId}</code></header>
          <Blocks blocks={block.content} sourceSessionId={sourceSessionId} loadImage={loadImage} />
        </section>
      case 'other':
        return <pre className="dsh-git-preview-other" key={key}>{json(block.value)}</pre>
    }
  })}</div>
}

function Record({
  record, sourceSessionId, loadImage,
}: {
  readonly record: HistoryPreviewRecord
  readonly sourceSessionId: string
  readonly loadImage: ChatHistoryPreviewProps['loadImage']
}) {
  const locale = useLocale()
  switch (record.kind) {
    case 'user':
      return <div
        className="dsh-git-preview-record dsh-git-preview-user"
        role="article"
        aria-label={localized('用户消息', 'User message', locale)}
      >
        <Blocks blocks={record.content} sourceSessionId={sourceSessionId} loadImage={loadImage} />
      </div>
    case 'assistant':
      return <div
        className="dsh-git-preview-record dsh-git-preview-assistant"
        role="article"
        aria-label={localized('Assistant 消息', 'Assistant message', locale)}
      >
        <Blocks blocks={record.blocks} sourceSessionId={sourceSessionId} loadImage={loadImage} hideToolCalls />
      </div>
    case 'tool-call':
      return <section className="dsh-git-preview-record dsh-git-preview-tool">
        <header><span>{record.name}</span><code>{record.callId}</code></header>
        <pre>{record.arguments}</pre>
      </section>
    case 'tool-result':
      return <section className="dsh-git-preview-record dsh-git-preview-tool">
        <header><span>{record.isError ? 'Tool error' : 'Tool result'}</span><code>{record.callId}</code></header>
        <Blocks blocks={record.content} sourceSessionId={sourceSessionId} loadImage={loadImage} />
      </section>
    case 'request':
      return <details className="dsh-git-preview-record dsh-git-preview-request">
        <summary>{record.requestKind === 'header' ? 'Request' : 'Context'}</summary>
        <pre>{json(record.data)}</pre>
      </details>
    case 'turn-status':
      return <div className="dsh-git-preview-record dsh-git-muted">{record.status}</div>
    case 'event':
      return <details className="dsh-git-preview-record dsh-git-preview-event">
        <summary>{record.eventType}</summary>
        <pre>{json(record.data)}</pre>
      </details>
  }
}

/** Read-only, official-style projection of the exact turns a Merge will seed. */
export function ChatHistoryPreview({
  response, orderedNodeIds, labels, candidateNodeId, loading, error, loadImage,
}: ChatHistoryPreviewProps) {
  const locale = useLocale()
  if (loading && response === null) {
    return <div className="dsh-git-chat-status" role="status">{localized('正在读取完整 Chat History…', 'Loading complete Chat History…', locale)}</div>
  }
  if (error !== null && response === null) {
    return <div className="dsh-git-chat-status dsh-git-error" role="alert">{error}</div>
  }
  if (response === null || response.turns.length === 0) {
    return <div className="dsh-git-chat-status">{localized('选择 PA 后，这里会显示合并后的聊天记录。', 'Select PAs to preview the merged chat history.', locale)}</div>
  }

  return <div className="dsh-git-chat-history" aria-busy={loading || undefined}>
    {response.turns.map((turn, index) => {
      const nodeId = orderedNodeIds[index]
      const candidate = nodeId !== undefined && nodeId === candidateNodeId
      return <section
        className={`dsh-git-preview-turn ${candidate ? 'dsh-git-preview-turn-candidate' : ''}`}
        key={`${turn.source.sourceSessionId}:${turn.source.sourceTurn}:${turn.source.sourceBoundarySeq}`}
        data-preview-state={candidate ? 'candidate' : 'selected'}
      >
        <header className="dsh-git-preview-turn-head">
          <strong>{nodeId === undefined ? `PA${turn.targetTurn}` : labels.get(nodeId) ?? `PA${turn.targetTurn}`}</strong>
          <span>{candidate ? localized('虚线预览', 'dashed preview', locale) : localized('已加入', 'included', locale)}</span>
        </header>
        {turn.records.map(record => <Record
          key={`${record.kind}:${record.seq}`}
          record={record}
          sourceSessionId={turn.source.sourceSessionId}
          loadImage={loadImage}
        />)}
      </section>
    })}
    {loading ? <div className="dsh-git-muted" role="status">{localized('正在更新预览…', 'Updating preview…', locale)}</div> : null}
    {error === null ? null : <div className="dsh-git-error" role="alert">{error}</div>}
  </div>
}
