import { useId, useState } from 'react'
import { estimateTokens, joinsLineages } from './graph.ts'
import { nodeLabelMap } from './labels.ts'
import { localized, useLocale } from './i18n.ts'
import type { GraphState, TurnNodeId } from './types.ts'

/** Presentation props for the ordered, page-local merge selection. */
export interface ContextTrayProps {
  readonly state: GraphState
  readonly selectedIds: readonly TurnNodeId[]
  /** Merge order as previewed: the selection with the candidate at its place. */
  readonly orderedIds: readonly TurnNodeId[]
  readonly candidateId: TurnNodeId | null
  readonly busy: boolean
  readonly error: string | null
  readonly dirty: boolean
  readonly draftHasContent: boolean
  readonly overLimit: boolean
  readonly onMove: (nodeId: TurnNodeId, beforeId: TurnNodeId) => void
  readonly onMoveEnd: (nodeId: TurnNodeId) => void
  readonly onRemove: (nodeId: TurnNodeId) => void
  readonly onMerge: () => Promise<void>
  /** Consumed by the composer-row discard action, not by the tray itself. */
  readonly onDiscard: (send: boolean) => void
  /** One refused official send while the Context is unmerged. */
  readonly onSendRefused: () => void
}

/** Draggable ordered PA selection. The resident DSH composer remains below it. */
export function ContextTray({
  state, selectedIds, orderedIds, candidateId, busy, error, dirty, overLimit,
  onMove, onMoveEnd, onRemove, onMerge,
}: ContextTrayProps) {
  const locale = useLocale()
  const [dragging, setDragging] = useState<TurnNodeId | null>(null)
  const [expandedByUser, setExpandedByUser] = useState(false)
  const detailsId = useId()
  const selectionState = { ...state, contextManifest: selectedIds }
  const labels = nodeLabelMap(state)
  const previewId = candidateId === null || selectedIds.includes(candidateId) ? null : candidateId
  // A selection that stays inside one Session branches it; only PAs from a
  // second Session make the new Chat a Merge. The preview counts, so the
  // action names what it would become.
  const action = joinsLineages(state, orderedIds) ? 'Merge' : 'Fork'
  const canMerge = !busy && !overLimit && selectedIds.length > 0 && candidateId === null
  const forcedExpanded = dirty || candidateId !== null || error !== null
  const expanded = forcedExpanded || expandedByUser

  // Match the resident Todo dock: an inactive, clean context costs no layout.
  if (selectedIds.length === 0 && !forcedExpanded) return null

  return <section className="dsh-git-tray" aria-label="Context Tray">
    <div className="dsh-git-tray-head">
      <div className="dsh-git-tray-summary">
        <strong>Context Tray</strong>
        <span className="dsh-git-muted dsh-git-tray-meta">
          {selectedIds.length} PA{previewId === null ? '' : localized(' + 1 预览', ' + 1 preview', locale)}
          {' · '}{localized('约', 'About', locale)} {estimateTokens(selectionState, selectedIds)} tokens
        </span>
      </div>
      <div className="dsh-git-tray-actions">
        <button
          className="dsh-git-button dsh-git-button-primary dsh-git-tray-merge"
          type="button"
          disabled={!canMerge}
          title={candidateId !== null
            ? localized('请先加入或关闭绿色候选 PA。', 'Add or close the green candidate PA first.', locale)
            : overLimit
              ? localized(`所选 PA 数量超过单次 ${action} 上限。`, `The selection exceeds the per-${action} limit.`, locale)
              : action === 'Fork'
                ? localized('当前选择只来自一个 Session：新 Chat 是这条对话的 Fork。', 'The selection comes from one Session: the new Chat forks this conversation.', locale)
                : localized('当前选择来自多个 Session：新 Chat 会 Merge 这些 PA。', 'The selection spans Sessions: the new Chat merges those PAs.', locale)}
          onClick={() => { void onMerge().catch(() => {}) }}
        >
          {busy ? localized('正在创建…', 'Creating…', locale) : action}
        </button>
        <button
          className="dsh-git-tray-toggle"
          type="button"
          aria-controls={detailsId}
          aria-expanded={expanded}
          aria-label={expanded
            ? localized('收起 Context Tray', 'Collapse Context Tray', locale)
            : localized('展开 Context Tray', 'Expand Context Tray', locale)}
          disabled={forcedExpanded}
          title={forcedExpanded
            ? localized('请先处理当前 Context 状态。', 'Resolve the current Context state first.', locale)
            : undefined}
          onClick={() => setExpandedByUser(value => !value)}
        >
          <span aria-hidden="true">{expanded ? '⌄' : '⌃'}</span>
        </button>
      </div>
    </div>
    {expanded ? <div className="dsh-git-tray-details" id={detailsId}>
      {orderedIds.length === 0 ? null : <div
        className="dsh-git-chips"
        aria-label={localized('已加入的 PA，拖动可调整合并顺序', 'Included PAs; drag to set merge order', locale)}
        onDragOver={event => event.preventDefault()}
        onDrop={() => {
          if (dragging !== null) onMoveEnd(dragging)
          setDragging(null)
        }}
      >
        {/* One row in previewed merge order: the dashed candidate reorders with
            the rest, so its place is chosen before it is ever added. */}
        {orderedIds.map((nodeId, index) => {
          const node = state.nodes[nodeId]
          if (node === undefined) return null
          const label = labels.get(nodeId) ?? 'PA'
          const preview = nodeId === previewId
          return <span
            className={preview ? 'dsh-git-chip dsh-git-chip-candidate' : 'dsh-git-chip'}
            draggable={!busy}
            key={nodeId}
            title={node.prompt}
            data-preview={preview ? 'candidate' : undefined}
            onDragStart={(event) => {
              event.stopPropagation()
              setDragging(nodeId)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={event => event.preventDefault()}
            onDrop={(event) => {
              event.stopPropagation()
              if (dragging !== null) onMove(dragging, nodeId)
              setDragging(null)
            }}
          >
            <span aria-hidden="true">{preview ? '⌁' : '⠿'}</span>
            {label}
            {preview ? <span className="dsh-git-chip-tag">{localized('预览', 'preview', locale)}</span> : null}
            <button
              type="button"
              disabled={busy || index === 0}
              aria-label={localized(`将 ${label} 向前移动`, `Move ${label} earlier`, locale)}
              onClick={() => {
                const previousId = orderedIds[index - 1]
                if (previousId !== undefined) onMove(nodeId, previousId)
              }}
            >‹</button>
            <button
              type="button"
              disabled={busy || index === orderedIds.length - 1}
              aria-label={localized(`将 ${label} 向后移动`, `Move ${label} later`, locale)}
              onClick={() => {
                const afterNextId = orderedIds[index + 2]
                if (afterNextId === undefined) onMoveEnd(nodeId)
                else onMove(nodeId, afterNextId)
              }}
            >›</button>
            <button
              type="button"
              disabled={busy}
              aria-label={preview
                ? localized(`关闭 ${label} 预览`, `Close the ${label} preview`, locale)
                : localized(`移除 ${label}`, `Remove ${label}`, locale)}
              onClick={() => onRemove(nodeId)}
            >×</button>
          </span>
        })}
      </div>}
      {error === null ? null : <div className="dsh-git-error" role="alert">{error}</div>}
    </div> : null}
  </section>
}
