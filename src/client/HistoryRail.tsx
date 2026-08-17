import { memo, useEffect, useState, type CSSProperties, type FocusEvent } from 'react'
import { localized, useLocale } from './i18n.ts'
import type { HistoryRailEntry, HistoryRailModel } from './history-rail.ts'
import type { TurnNodeId } from './types.ts'

export interface HistoryRailProps extends HistoryRailModel {
  readonly disabled?: boolean
  /** The Chat History panel owns the full workbench after the graph is closed. */
  readonly expanded?: boolean
  readonly onSelect: (nodeId: TurnNodeId) => void
  /** Keeps the rail and the PA rendered in Chat History in lockstep. */
  readonly onActiveChange?: (nodeId: TurnNodeId | null) => void
}

/**
 * The 30px conversation trail beside Chat History.
 *
 * Every dash is the PA at the same index in the right-hand preview. In compact
 * mode a dash stretches into its PA/title row. When Chat History owns the full
 * workbench, the same entries become rows whose hover card summarizes the PA.
 */
function HistoryRailView({
  entries, includedCount, previewCount, disabled = false, expanded = false,
  onSelect, onActiveChange,
}: HistoryRailProps) {
  const locale = useLocale()
  const [activeId, setActiveId] = useState<TurnNodeId | null>(null)
  const [summaryTop, setSummaryTop] = useState<number | null>(null)

  useEffect(() => {
    if (activeId === null || entries.some(entry => entry.nodeId === activeId)) return
    setActiveId(null)
    setSummaryTop(null)
    onActiveChange?.(null)
  }, [activeId, entries, onActiveChange])

  if (entries.length === 0) return null

  const included = localized('已加入', 'included', locale)
  const preview = localized('预览', 'preview', locale)
  const noPrompt = localized('（无文字问题）', '(No text prompt)', locale)
  const noSummary = localized('该 PA 没有可显示的回答摘要。', 'This PA has no answer summary to display.', locale)
  const counts = previewCount === 0
    ? `${includedCount} ${included}`
    : `${includedCount} ${included} · ${previewCount} ${preview}`

  const activate = (entry: HistoryRailEntry): void => {
    setActiveId(entry.nodeId)
    onActiveChange?.(entry.nodeId)
  }
  const clear = (): void => {
    setActiveId(null)
    setSummaryTop(null)
    onActiveChange?.(null)
  }
  const blur = (event: FocusEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    clear()
  }
  const activateExpanded = (entry: HistoryRailEntry, element: HTMLElement): void => {
    activate(entry)
    const rail = element.closest<HTMLElement>('.dsh-git-rail-expanded')
    if (rail === null) return
    const rowRect = element.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()
    setSummaryTop(rowRect.top - railRect.top + rowRect.height / 2)
  }

  const activeEntry = activeId === null ? undefined : entries.find(entry => entry.nodeId === activeId)

  if (expanded) return <nav
    className="dsh-git-rail dsh-git-rail-expanded"
    aria-label={`${localized('会话轨迹', 'Conversation trail', locale)} · ${counts}`}
    onPointerLeave={(event) => {
      if (!event.currentTarget.contains(document.activeElement)) clear()
    }}
  >
    <div className="dsh-git-rail-expanded-scroll" onScroll={clear}>
      <header className="dsh-git-rail-expanded-head">
        <span>{localized('会话轨迹', 'Conversation trail', locale)}</span>
        <span>{counts}</span>
      </header>
      <ol className="dsh-git-rail-expanded-list">
        {entries.map(entry => {
          const title = entry.prompt || noPrompt
          const active = entry.nodeId === activeId
          return <li key={entry.nodeId}>
            <button
              className="dsh-git-rail-expanded-row"
              type="button"
              disabled={disabled}
              style={{ '--dsh-git-rail-indent': String(entry.indent) } as CSSProperties}
              data-rail-state={entry.state}
              data-active={active ? '' : undefined}
              data-head={entry.head ? '' : undefined}
              data-branched={entry.branched ? '' : undefined}
              data-node-id={entry.nodeId}
              aria-label={`${entry.label} · ${title}`}
              aria-current={entry.head ? 'true' : undefined}
              aria-controls={`dsh-git-history-${entry.nodeId}`}
              aria-describedby={active ? `dsh-git-rail-summary-${entry.nodeId}` : undefined}
              onPointerEnter={event => activateExpanded(entry, event.currentTarget)}
              onFocus={event => activateExpanded(entry, event.currentTarget)}
              onBlur={blur}
              onClick={() => onSelect(entry.nodeId)}
            >
              {entry.branched ? <span className="dsh-git-rail-expanded-elbow" aria-hidden="true" /> : null}
              <span className="dsh-git-rail-expanded-label">{entry.label}</span>
              {entry.head ? <span className="dsh-git-rail-expanded-head-tag">HEAD</span> : null}
              <span className="dsh-git-rail-expanded-dot" aria-hidden="true" />
              <span className="dsh-git-rail-expanded-prompt">{title}</span>
              {entry.state === 'preview'
                ? <span className="dsh-git-rail-expanded-preview">{preview}</span>
                : null}
            </button>
          </li>
        })}
      </ol>
    </div>
    {activeEntry === undefined || summaryTop === null ? null : <aside
      className="dsh-git-rail-summary"
      id={`dsh-git-rail-summary-${activeEntry.nodeId}`}
      role="tooltip"
      data-rail-state={activeEntry.state}
      style={{ '--dsh-git-rail-summary-top': `${summaryTop}px` } as CSSProperties}
    >
      <strong>
        <span>{activeEntry.label}</span>
        <span className="dsh-git-rail-summary-dot" aria-hidden="true" />
        <span>{activeEntry.summaryTitle || activeEntry.prompt || noPrompt}</span>
      </strong>
      <span>{activeEntry.summary || noSummary}</span>
    </aside>}
  </nav>

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

/** Memoized: the trail only changes with the selection, never with a delta. */
export const HistoryRail = memo(HistoryRailView)
