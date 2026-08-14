import { useState } from 'react'
import { estimateTokens, missingDirectDependencies } from './graph.ts'
import { nodeLabelMap } from './labels.ts'
import { localized, useLocale } from './i18n.ts'
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

/** Draggable ordered context selection and branch-creating prompt composer. */
export function ContextTray({
  state, busy, error, onMove, onMoveEnd, onRemove, onClear, onAsk,
}: ContextTrayProps) {
  const locale = useLocale()
  const [question, setQuestion] = useState('')
  const [dragging, setDragging] = useState<TurnNodeId | null>(null)
  const missing = missingDirectDependencies(state, state.contextManifest)
  const labels = nodeLabelMap(state)
  const canAsk = !busy && question.trim() !== '' && state.contextManifest.length > 0

  const submit = async (): Promise<void> => {
    if (!canAsk) return
    await onAsk(question)
    setQuestion('')
  }

  return <section className="dsh-git-tray" aria-label="Context Tray">
    <div className="dsh-git-tray-head">
      <strong>Context Tray</strong>
      <span className="dsh-git-muted">{localized('约', 'About', locale)} {estimateTokens(state, state.contextManifest)} tokens · {localized('可拖动排序', 'drag to reorder', locale)}</span>
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
        ? <span className="dsh-git-muted">{localized('在上方分叉图中勾选 PA 节点', 'Select PA nodes in the graph above', locale)}</span>
        : state.contextManifest.map((nodeId) => {
          const node = state.nodes[nodeId]
          if (node === undefined) return null
          const label = labels.get(nodeId) ?? 'PA'
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
            {label}
            <button type="button" aria-label={localized(`移除 ${label}`, `Remove ${label}`, locale)} onClick={() => onRemove(nodeId)}>×</button>
          </span>
        })}
    </div>
    {missing.length > 0
      ? <div className="dsh-git-warning">{localized(
          `自由选择模式：${missing.map(id => labels.get(id) ?? 'PA').join('、')} 未加入；模型只接收 Tray 中列出的 PA。`,
          `Free selection: ${missing.map(id => labels.get(id) ?? 'PA').join(', ')} not included; the model receives only the PAs listed in the Tray.`, locale,
        )}</div>
      : null}
    <textarea
      className="dsh-git-question"
      value={question}
      disabled={busy}
      placeholder={localized('输入下一个问题；提交后会自动建立新的 merge branch…', 'Enter your next question; submitting creates a new merge branch…', locale)}
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
      <button className="dsh-git-button" type="button" disabled={busy || state.contextManifest.length === 0} onClick={onClear}>{localized('清空', 'Clear', locale)}</button>
      <button className="dsh-git-button dsh-git-button-primary" type="button" disabled={!canAsk} onClick={() => { void submit().catch(() => {}) }}>
        {busy ? localized('正在创建 branch…', 'Creating branch…', locale) : localized('创建 merge branch 并提问 →', 'Create merge branch and ask →', locale)}
      </button>
    </div>
  </section>
}
