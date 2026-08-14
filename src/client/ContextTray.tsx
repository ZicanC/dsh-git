import { useState } from 'react'
import { estimateTokens, missingDirectDependencies } from './graph.ts'
import type { GraphState, TurnNodeId } from './types.ts'

/** Presentation-only props for the ordered next-request context tray. */
export interface ContextTrayProps {
  readonly state: GraphState
  readonly busy: boolean
  readonly error: string | null
  readonly onMove: (nodeId: TurnNodeId, beforeId: TurnNodeId) => void
  readonly onMoveEnd: (nodeId: TurnNodeId) => void
  readonly onRemove: (nodeId: TurnNodeId) => void
  readonly onClear: () => void
  readonly onAsk: (question: string) => Promise<void>
}

function shortId(id: string): string {
  return id.startsWith('pa-') ? `PA-${id.slice(-5)}` : id.slice(-8)
}

/** Draggable ordered context selection and branch-creating prompt composer. */
export function ContextTray({
  state, busy, error, onMove, onMoveEnd, onRemove, onClear, onAsk,
}: ContextTrayProps) {
  const [question, setQuestion] = useState('')
  const [dragging, setDragging] = useState<TurnNodeId | null>(null)
  const missing = missingDirectDependencies(state, state.contextManifest)
  const canAsk = !busy && question.trim() !== '' && state.contextManifest.length > 0

  const submit = async (): Promise<void> => {
    if (!canAsk) return
    await onAsk(question)
    setQuestion('')
  }

  return <section className="dsh-git-tray" aria-label="Context Tray">
    <div className="dsh-git-tray-head">
      <strong>Context Tray</strong>
      <span className="dsh-git-muted">约 {estimateTokens(state, state.contextManifest)} tokens · 可拖动排序</span>
    </div>
    <div
      className="dsh-git-chips"
      onDragOver={event => event.preventDefault()}
      onDrop={() => {
        if (dragging !== null) onMoveEnd(dragging)
        setDragging(null)
      }}
    >
      {state.contextManifest.length === 0
        ? <span className="dsh-git-muted">在上方分叉图中勾选 PA 节点</span>
        : state.contextManifest.map((nodeId) => {
          const node = state.nodes[nodeId]
          if (node === undefined) return null
          return <span
            className="dsh-git-chip"
            draggable
            key={nodeId}
            title={node.prompt}
            onDragStart={(event) => {
              event.stopPropagation()
              setDragging(nodeId)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={event => event.preventDefault()}
            onDrop={(event) => {
              event.stopPropagation()
              if (dragging !== null) onMove(dragging, nodeId)
              setDragging(null)
            }}
          >
            <span aria-hidden="true">⠿</span>
            {shortId(nodeId)}
            <button type="button" aria-label={`移除 ${shortId(nodeId)}`} onClick={() => onRemove(nodeId)}>×</button>
          </span>
        })}
    </div>
    {missing.length > 0
      ? <div className="dsh-git-warning">自由选择模式：{missing.map(shortId).join('、')} 未加入；模型只接收 Tray 中列出的 PA。</div>
      : null}
    <textarea
      className="dsh-git-question"
      value={question}
      disabled={busy}
      placeholder="输入下一个问题；提交后会自动建立新的 merge branch…"
      onChange={event => setQuestion(event.target.value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          void submit().catch(() => {})
        }
      }}
    />
    {error === null ? null : <div className="dsh-git-error" role="alert">{error}</div>}
    <div className="dsh-git-actions">
      <button className="dsh-git-button" type="button" disabled={busy || state.contextManifest.length === 0} onClick={onClear}>清空</button>
      <button className="dsh-git-button dsh-git-button-primary" type="button" disabled={!canAsk} onClick={() => { void submit().catch(() => {}) }}>
        {busy ? '正在创建 branch…' : '创建 merge branch 并提问 →'}
      </button>
    </div>
  </section>
}
