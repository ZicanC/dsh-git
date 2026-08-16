import { useEffect, useState, type CSSProperties, type FocusEvent } from 'react'
import { localized, useLocale } from './i18n.ts'
import type { HistoryRailEntry, HistoryRailModel } from './history-rail.ts'
import type { TurnNodeId } from './types.ts'

export interface HistoryRailProps extends HistoryRailModel {
  readonly disabled?: boolean
  readonly onSelect: (nodeId: TurnNodeId) => void
  /** Keeps the rail and the PA rendered in Chat History in lockstep. */
  readonly onActiveChange?: (nodeId: TurnNodeId | null) => void
}

/**
 * The 30px conversation trail beside Chat History.
 *
 * Every dash is the PA at the same index in the right-hand preview. Hovering a
 * dash stretches that dash into its PA/title row; it never substitutes an
 * answer card or a second, independently ordered list.
 */
export function HistoryRail({
  entries, includedCount, previewCount, disabled = false, onSelect, onActiveChange,
}: HistoryRailProps) {
  const locale = useLocale()
  const [activeId, setActiveId] = useState<TurnNodeId | null>(null)

  useEffect(() => {
    if (activeId === null || entries.some(entry => entry.nodeId === activeId)) return
    setActiveId(null)
    onActiveChange?.(null)
  }, [activeId, entries, onActiveChange])

  if (entries.length === 0) return null

  const included = localized('已加入', 'included', locale)
  const preview = localized('预览', 'preview', locale)
  const noPrompt = localized('（无文字问题）', '(No text prompt)', locale)
  const counts = previewCount === 0
    ? `${includedCount} ${included}`
    : `${includedCount} ${included} · ${previewCount} ${preview}`

  const activate = (entry: HistoryRailEntry): void => {
    setActiveId(entry.nodeId)
    onActiveChange?.(entry.nodeId)
  }
  const clear = (): void => {
    setActiveId(null)
    onActiveChange?.(null)
  }
  const blur = (event: FocusEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    clear()
  }

  return <nav
    className="dsh-git-rail"
    data-active={activeId === null ? undefined : ''}
    aria-label={`${localized('会话轨迹', 'Conversation trail', locale)} · ${counts}`}
    onPointerLeave={(event) => {
      if (!event.currentTarget.contains(document.activeElement)) clear()
    }}
  >
    <div className="dsh-git-rail-scroll">
      <ol className="dsh-git-rail-list">
        {entries.map(entry => {
          const title = entry.prompt || noPrompt
          const active = entry.nodeId === activeId
          return <li
            className="dsh-git-rail-item"
            key={entry.nodeId}
            style={{ '--dsh-git-rail-indent': String(entry.indent) } as CSSProperties}
          >
            <button
              className="dsh-git-rail-dash"
              type="button"
              disabled={disabled}
              style={{ '--dsh-git-rail-dash-width': `${entry.width}px` } as CSSProperties}
              data-rail-state={entry.state}
              data-active={active ? '' : undefined}
              data-head={entry.head ? '' : undefined}
              data-branched={entry.branched ? '' : undefined}
              data-node-id={entry.nodeId}
              aria-label={`${entry.label} · ${title}`}
              aria-current={entry.head ? 'true' : undefined}
              aria-controls={`dsh-git-history-${entry.nodeId}`}
              onPointerEnter={() => activate(entry)}
              onFocus={() => activate(entry)}
              onBlur={blur}
              onClick={() => onSelect(entry.nodeId)}
            >
              <span className="dsh-git-rail-stroke" aria-hidden="true" />
              <span className="dsh-git-rail-copy">
                <span className="dsh-git-rail-state-line" aria-hidden="true" />
                {entry.branched ? <span className="dsh-git-rail-elbow" aria-hidden="true" /> : null}
                <span className="dsh-git-rail-label">{entry.label}</span>
                {entry.head ? <span className="dsh-git-rail-head">HEAD</span> : null}
                <span className="dsh-git-rail-dot" aria-hidden="true" />
                <span className="dsh-git-rail-prompt">{title}</span>
                {entry.state === 'preview' ? <span className="dsh-git-rail-tag">{preview}</span> : null}
              </span>
            </button>
          </li>
        })}
      </ol>
    </div>
  </nav>
}
