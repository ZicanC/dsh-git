import { nodeHash, nodeLabelMap } from './labels.ts'
import { localized, useLocale } from './i18n.ts'
import type { GraphState, TurnNodeId } from './types.ts'

export interface PAContextWindowProps {
  readonly state: GraphState
  readonly nodeId: TurnNodeId
  readonly label: string
  readonly selected: boolean
  readonly disabled: boolean
  readonly onAdd: () => void
  readonly onRemove: () => void
  readonly onClose: () => void
}

/**
 * Compact summary of one PA selection: number, title, hash, the Context that
 * answered it, and the explicit commit/remove action. The prompt and answer
 * bodies stay in Chat History rather than being repeated here.
 */
export function PAContextWindow({
  state, nodeId, label, selected, disabled, onAdd, onRemove, onClose,
}: PAContextWindowProps) {
  const locale = useLocale()
  const node = state.nodes[nodeId]
  if (node === undefined) return null
  const labels = nodeLabelMap(state)

  return <section id="dsh-git-pa-context-window" className="dsh-git-context-window" aria-label="PA Context Window">
    <header className="dsh-git-heading">
      <span className="dsh-git-heading-title">
        <span className="dsh-git-heading-label">{label} Context</span>
        <code className="dsh-git-heading-hash" title={node.id}>{nodeHash(node.id)}</code>
      </span>
      <span className="dsh-git-heading-actions">
        <button
          className={`dsh-git-button dsh-git-button-compact ${selected ? '' : 'dsh-git-button-primary'}`}
          type="button"
          disabled={disabled}
          onClick={selected ? onRemove : onAdd}
        >
          {selected
            ? localized('移出 Context', 'Remove from Context', locale)
            : localized('加入 Context', 'Add to Context', locale)}
        </button>
        <button className="dsh-git-close" type="button" aria-label={localized('关闭 PA Context Window', 'Close PA Context Window', locale)} onClick={onClose}>×</button>
      </span>
    </header>
    <div className="dsh-git-inspector">
      <h3>{node.prompt || localized('（无文字问题）', '(No text prompt)', locale)}</h3>
      <section className="dsh-git-context-history" aria-label={localized('回答时使用的 Context', 'Context used for this answer', locale)}>
        <span className="dsh-git-message-label">{localized('回答时使用的 CONTEXT', 'CONTEXT USED FOR THIS ANSWER', locale)}</span>
        {node.contextManifest.length === 0
          ? <div className="dsh-git-muted">{localized('该节点没有前置 Context。', 'This node has no preceding Context.', locale)}</div>
          : <ol>{node.contextManifest.map(contextId => {
            const context = state.nodes[contextId]
            if (context === undefined) return null
            return <li key={contextId}>
              <strong>{labels.get(contextId) ?? nodeHash(contextId)}</strong>
              <span>{context.prompt || localized('（无文字问题）', '(No text prompt)', locale)}</span>
            </li>
          })}</ol>}
      </section>
    </div>
  </section>
}
