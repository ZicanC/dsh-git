import { useId, useState } from 'react'
import { estimateTokens } from './graph.ts'
import { nodeLabelMap } from './labels.ts'
import { localized, useLocale } from './i18n.ts'
import type { GraphState, TurnNodeId } from './types.ts'

/** Presentation props for the ordered, page-local merge selection. */
export interface ContextTrayProps {
  readonly state: GraphState
  readonly selectedIds: readonly TurnNodeId[]
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
}

/** Draggable ordered PA selection. The resident DSH composer remains below it. */
export function ContextTray({
  state, selectedIds, candidateId, busy, error, dirty, overLimit,
  onMove, onMoveEnd, onRemove, onMerge,
}: ContextTrayProps) {
  const locale = useLocale()
  const [dragging, setDragging] = useState<TurnNodeId | null>(null)
  const [expandedByUser, setExpandedByUser] = useState(false)
  const detailsId = useId()
  const selectionState = { ...state, contextManifest: selectedIds }
  const labels = nodeLabelMap(state)
  const candidateNode = candidateId === null || selectedIds.includes(candidateId)
    ? undefined
    : state.nodes[candidateId]
  const candidateLabel = candidateId === null ? 'PA' : labels.get(candidateId) ?? 'PA'
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
          {selectedIds.length} PA{candidateNode === undefined ? '' : localized(' + 1 预览', ' + 1 preview', locale)}
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
              ? localized('所选 PA 数量超过单次 Merge 上限。', 'The selection exceeds the per-Merge limit.', locale)
              : undefined}
          onClick={() => { void onMerge().catch(() => {}) }}
        >
          {busy ? localized('正在创建…', 'Creating…', locale) : 'Merge'}
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
      {selectedIds.length === 0 && candidateNode === undefined ? null : <div
        className="dsh-git-chips"
        aria-label={localized('已加入的 PA，拖动可调整合并顺序', 'Included PAs; drag to set merge order', locale)}
        onDragOver={event => event.preventDefault()}
        onDrop={() => {
          if (dragging !== null) onMoveEnd(dragging)
          setDragging(null)
        }}
      >
        {selectedIds.map((nodeId, index) => {
          const node = state.nodes[nodeId]
          if (node === undefined) return null
          const label = labels.get(nodeId) ?? 'PA'
          return <span
            className="dsh-git-chip"
            draggable={!busy}
            key={nodeId}
            title={node.prompt}
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
            <span aria-hidden="true">⠿</span>
            {label}
            <button
              type="button"
              disabled={busy || index === 0}
              aria-label={localized(`将 ${label} 向前移动`, `Move ${label} earlier`, locale)}
              onClick={() => {
                const previousId = selectedIds[index - 1]
                if (previousId !== undefined) onMove(nodeId, previousId)
              }}
            >‹</button>
            <button
              type="button"
              disabled={busy || index === selectedIds.length - 1}
              aria-label={localized(`将 ${label} 向后移动`, `Move ${label} later`, locale)}
              onClick={() => {
                const afterNextId = selectedIds[index + 2]
                if (afterNextId === undefined) onMoveEnd(nodeId)
                else onMove(nodeId, afterNextId)
              }}
            >›</button>
            <button type="button" disabled={busy} aria-label={localized(`移除 ${label}`, `Remove ${label}`, locale)} onClick={() => onRemove(nodeId)}>×</button>
          </span>
        })}
        {/* The preview rides in the same row as a dashed chip: visible in the
            order it would merge in, but never draggable and never counted. */}
        {candidateNode === undefined || candidateId === null ? null : <span
          className="dsh-git-chip dsh-git-chip-candidate"
          key={candidateId}
          title={candidateNode.prompt}
          data-preview="candidate"
        >
          <span aria-hidden="true">⌁</span>
          {candidateLabel}
          <span className="dsh-git-chip-tag">{localized('预览', 'preview', locale)}</span>
          <button
            type="button"
            disabled={busy}
            aria-label={localized(`关闭 ${candidateLabel} 预览`, `Close the ${candidateLabel} preview`, locale)}
            onClick={() => onRemove(candidateId)}
          >×</button>
        </span>}
      </div>}
      {error === null ? null : <div className="dsh-git-error" role="alert">{error}</div>}
    </div> : null}
  </section>
}
