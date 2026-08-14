/** Project-level Conversation Graph takeover page with a Fusion-style PA timeline. */
import { useEffect, useMemo, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectGraphResponse } from '../protocol.ts'
import { GraphCanvas } from './GraphCanvas.tsx'
import { assembleProjectGraph, projectGraphAt, type ProjectGraphModel } from './project-graph.ts'
import type { GraphState, TurnNodeId } from './types.ts'

export interface ProjectGraphPageProps {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly sessionTitles: Readonly<Record<string, string>>
  readonly load: (signal: AbortSignal) => Promise<ProjectGraphResponse>
  readonly getLocalState: () => GraphState
  readonly onClose: () => void
  readonly onOpenSession: (sessionId: string) => void
}

function formatTime(time: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(time))
}

function loadingText(error: string | null): string {
  return error === null ? '正在读取项目中的全部 Session…' : error
}

/** Full takeover page mounted by the sidebar compatibility bridge. */
export function ProjectGraphPage({
  workspaceId, workspaceTitle, sessionTitles, load, getLocalState, onClose, onOpenSession,
}: ProjectGraphPageProps) {
  const [model, setModel] = useState<ProjectGraphModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [cursor, setCursor] = useState(1)
  const [inspectedId, setInspectedId] = useState<TurnNodeId | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    load(controller.signal).then((response) => {
      if (controller.signal.aborted) return
      const next = assembleProjectGraph(response, getLocalState(), sessionTitles)
      setModel(next)
      setCursor(Math.max(1, next.timeline.length))
      setInspectedId(null)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { controller.abort() }
  }, [workspaceId, refreshKey, load, getLocalState, sessionTitles])

  useEffect(() => {
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [onClose])

  const labels = useMemo(() => new Map(model?.timeline.map((id, index) => [id, `PA${index + 1}`]) ?? []), [model])
  const nodeColors = useMemo(() => {
    const colors = new Map<TurnNodeId, number>()
    if (model === null) return colors
    const sessions = new Map<string, number>()
    for (const id of model.timeline) {
      const node = model.nodes[id]
      if (node === undefined) continue
      if (!sessions.has(node.sessionId)) sessions.set(node.sessionId, sessions.size % 8)
      colors.set(id, sessions.get(node.sessionId)!)
    }
    return colors
  }, [model])
  const visible = model === null || model.timeline.length === 0 ? null : projectGraphAt(model, cursor)
  const selectedId = model?.timeline[Math.max(0, cursor - 1)]
  const selected = selectedId === undefined ? undefined : model?.nodes[selectedId]
  const inspected = inspectedId === null ? undefined : model?.nodes[inspectedId]

  return <div className="dsh-git-project-page" role="dialog" aria-label={`${workspaceTitle} Conversation Graph`}>
    <header className="dsh-git-project-header">
      <div>
        <h1>{workspaceTitle}</h1>
        <span>Conversation Graph</span>
      </div>
      <div className="dsh-git-project-summary">
        <span>{model?.sessionCount ?? 0} Sessions</span>
        <span>{model?.timeline.length ?? 0} PA</span>
        <button type="button" onClick={() => { setModel(null); setRefreshKey(value => value + 1) }}>刷新</button>
        <button type="button" aria-label="关闭项目 Conversation Graph" onClick={onClose}>×</button>
      </div>
    </header>

    {model === null
      ? <main className="dsh-git-project-status" role={error === null ? 'status' : 'alert'}>
          <p>{loadingText(error)}</p>
          {error === null ? null : <button type="button" onClick={() => { setModel(null); setRefreshKey(value => value + 1) }}>重试</button>}
        </main>
      : model.timeline.length === 0
        ? <main className="dsh-git-project-status"><p>这个项目还没有已完成的 PA。</p></main>
        : <main className={`dsh-git-project-main ${inspected === undefined ? '' : 'dsh-git-project-main-open'}`}>
            <section className="dsh-git-project-canvas" aria-label="项目 Conversation Graph">
              <GraphCanvas
                state={visible!}
                previewNodeId={inspectedId}
                onPreview={setInspectedId}
                labels={labels}
                nodeColors={nodeColors}
                fit={false}
              />
            </section>
            {inspected === undefined ? null : <aside className="dsh-git-project-inspector" aria-label="项目 PA 详情">
              <header>
                <strong>{labels.get(inspected.id) ?? 'PA'} · {inspected.sessionTitle}</strong>
                <button type="button" aria-label="关闭 PA 详情" onClick={() => setInspectedId(null)}>×</button>
              </header>
              <div className="dsh-git-project-inspector-body">
                <dl>
                  <div><dt>Session</dt><dd>{inspected.sessionTitle}</dd></div>
                  <div><dt>Session ID</dt><dd><code>{inspected.sessionId}</code></dd></div>
                  <div><dt>Turn</dt><dd>{inspected.turn}</dd></div>
                  <div><dt>PA 完成</dt><dd>{formatTime(inspected.completedAt)}</dd></div>
                  <div><dt>Session 创建</dt><dd>{formatTime(inspected.sessionCreatedAt)}</dd></div>
                </dl>
                <section className="dsh-git-message"><span className="dsh-git-message-label">PROMPT</span><MarkdownText text={inspected.prompt || '（无文字问题）'} /></section>
                <section className="dsh-git-message"><span className="dsh-git-message-label">ANSWER</span><MarkdownText text={inspected.answer || '（没有文字回答）'} /></section>
                <section className="dsh-git-context-history">
                  <span className="dsh-git-message-label">CONTEXT</span>
                  {inspected.contextManifest.length === 0
                    ? <span className="dsh-git-muted">没有前置 Context</span>
                    : <ol>{inspected.contextManifest.map(id => <li key={id}>{labels.get(id) ?? id}</li>)}</ol>}
                </section>
                <button className="dsh-git-button dsh-git-button-primary" type="button" onClick={() => onOpenSession(inspected.sessionId)}>打开原会话</button>
              </div>
            </aside>}
          </main>}

    {model === null || model.timeline.length === 0 ? null : <footer className="dsh-git-timeline" aria-label="PA 时间轴">
      <div className="dsh-git-timeline-readout">
        <strong>{labels.get(selectedId!)}</strong>
        <span>{selected?.sessionTitle}</span>
        <time>{selected === undefined ? '' : formatTime(selected.completedAt)}</time>
      </div>
      <div className="dsh-git-timeline-controls">
        <button type="button" aria-label="上一个 PA" disabled={cursor <= 1} onClick={() => setCursor(value => Math.max(1, value - 1))}>‹</button>
        <div className="dsh-git-timeline-track">
          <div className="dsh-git-timeline-session-marks" aria-hidden="true">
            {model.timeline.map((id, index) => model.nodes[id]?.firstInSession
              ? <span key={id} style={{ left: `${model.timeline.length === 1 ? 0 : index / (model.timeline.length - 1) * 100}%` }} />
              : null)}
          </div>
          <input
            type="range"
            min={1}
            max={model.timeline.length}
            step={1}
            value={cursor}
            aria-label="PA 时间轴游标"
            aria-valuetext={`${labels.get(selectedId!)} ${selected?.sessionTitle ?? ''}`}
            onChange={event => { setCursor(Number(event.currentTarget.value)); setInspectedId(null) }}
          />
        </div>
        <button type="button" aria-label="下一个 PA" disabled={cursor >= model.timeline.length} onClick={() => setCursor(value => Math.min(model.timeline.length, value + 1))}>›</button>
      </div>
    </footer>}
  </div>
}
