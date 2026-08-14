import { useEffect, useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { GraphRepository } from './repository.ts'
import { extractCompletedTurns } from './extract.ts'
import { ContextTray } from './ContextTray.tsx'
import { GraphCanvas } from './GraphCanvas.tsx'
import { nodeHash, nodeLabelMap } from './labels.ts'
import type { BranchId, GraphState, ImportedTurn, TurnNodeId } from './types.ts'

/** Browser callbacks and observable supplied from the plugin apply closure. */
export interface GraphViewInjected {
  readonly hooks: { graph: GraphRepository }
  readonly syncTurns: (turns: readonly ImportedTurn[]) => void
  readonly toggleContext: (nodeId: TurnNodeId) => void
  readonly moveContext: (nodeId: TurnNodeId, beforeId: TurnNodeId) => void
  readonly moveContextToEnd: (nodeId: TurnNodeId) => void
  readonly clearContext: () => void
  readonly checkout: (nodeId: TurnNodeId) => void
  readonly renameBranch: (branchId: BranchId, name: string) => void
  readonly ask: (question: string, manifest: readonly TurnNodeId[]) => Promise<void>
}

function BranchControls({
  branchId, name, current, onCheckout, onRename,
}: {
  readonly branchId: BranchId
  readonly name: string
  readonly current: boolean
  readonly onCheckout: () => void
  readonly onRename: (branchId: BranchId, name: string) => void
}) {
  const [draft, setDraft] = useState(name)
  const commit = (): void => {
    const normalized = draft.trim()
    if (normalized === '') setDraft(name)
    else onRename(branchId, normalized)
  }
  return <div className="dsh-git-inspector-actions">
    <input
      className="dsh-git-branch-name"
      aria-label="Branch 名称"
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') { setDraft(name); event.currentTarget.blur() }
      }}
    />
    <button className="dsh-git-button" type="button" disabled={current} onClick={onCheckout}>
      {current ? '当前 HEAD' : '切换到此分支'}
    </button>
  </div>
}

/** Complete graph view registered as one conversation tab. */
export function GraphView({
  useSession, useGraph, syncTurns, toggleContext, moveContext, moveContextToEnd,
  clearContext, checkout, renameBranch, ask,
}: ConvViewProps & InjectFace<GraphViewInjected>) {
  const snapshot = useSession(value => value)
  const state = useGraph((value: GraphState) => value)
  const turns = useMemo(() => extractCompletedTurns(snapshot), [snapshot])
  const signature = turns.map(turn => `${turn.turn}:${turn.boundarySeq}:${turn.answer.length}`).join('|')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inspectedNodeId, setInspectedNodeId] = useState<TurnNodeId | null>(null)

  useEffect(() => { syncTurns(turns) }, [signature, syncTurns])

  const inspected = inspectedNodeId === null ? undefined : state.nodes[inspectedNodeId]
  const inspectedBranch = inspected === undefined ? undefined : state.branches[inspected.branchId]
  const labels = useMemo(() => nodeLabelMap(state), [state])
  const submit = async (question: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await ask(question, state.contextManifest)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  return <div className="dsh-git-root" data-conversation-composer-overlay="">
    <div className={`dsh-git-workbench ${inspected === undefined ? '' : 'dsh-git-workbench-open'}`}>
      <section className="dsh-git-panel" aria-label="Conversation Graph">
        <header className="dsh-git-heading">
          <span>Conversation Graph</span>
          <span className="dsh-git-muted">点击节点查看 Context · 虚线为 merge</span>
        </header>
        <GraphCanvas state={state} previewNodeId={inspectedNodeId} onPreview={setInspectedNodeId} />
      </section>
      {inspected === undefined ? null : <aside className="dsh-git-panel" aria-label="节点 Context">
        <header className="dsh-git-heading">
          <span>{labels.get(inspected.id) ?? 'PA'} Context</span>
          <button className="dsh-git-close" type="button" aria-label="关闭节点 Context" onClick={() => setInspectedNodeId(null)}>×</button>
        </header>
          <div className="dsh-git-inspector">
            <h3>{inspected.prompt || '（无文字问题）'}</h3>
            <div className="dsh-git-node-hash">
              <span>HASH</span>
              <code>{nodeHash(inspected.id)}</code>
            </div>
            {inspectedBranch === undefined ? null : <BranchControls
              key={inspectedBranch.id}
              branchId={inspectedBranch.id}
              name={inspectedBranch.name}
              current={inspected.id === state.headNodeId}
              onCheckout={() => checkout(inspected.id)}
              onRename={renameBranch}
            />}
            <button className="dsh-git-button" type="button" onClick={() => toggleContext(inspected.id)}>
              {state.contextManifest.includes(inspected.id) ? '从 Context Tray 移除' : '加入 Context Tray'}
            </button>
            <section className="dsh-git-context-history" aria-label="回答时使用的 Context">
              <span className="dsh-git-message-label">回答时使用的 CONTEXT</span>
              {inspected.contextManifest.length === 0
                ? <div className="dsh-git-muted">该节点没有前置 Context。</div>
                : <ol>{inspected.contextManifest.map(nodeId => {
                  const contextNode = state.nodes[nodeId]
                  if (contextNode === undefined) return null
                  return <li key={nodeId}>
                    <strong>{labels.get(nodeId) ?? 'PA'}</strong>
                    <span>{contextNode.prompt || '（无文字问题）'}</span>
                  </li>
                })}</ol>}
            </section>
            <div className="dsh-git-message">
              <span className="dsh-git-message-label">PROMPT</span>
              <MarkdownText text={inspected.prompt || '（无文字问题）'} />
            </div>
            <div className="dsh-git-message">
              <span className="dsh-git-message-label">ANSWER</span>
              <MarkdownText text={inspected.answer || '（没有文字回答）'} />
            </div>
            <div className="dsh-git-muted">parents: {inspected.parentIds.length || 0} · context: {inspected.contextManifest.length || 0}</div>
          </div>
      </aside>}
    </div>
    <ContextTray
      state={state}
      busy={busy}
      error={error}
      onMove={moveContext}
      onMoveEnd={moveContextToEnd}
      onRemove={toggleContext}
      onClear={clearContext}
      onAsk={submit}
    />
  </div>
}
