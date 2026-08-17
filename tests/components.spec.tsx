// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { HistoryPreviewResponse, HistoryTurnSource } from '../src/protocol.ts'
import { ComposerDiscardAction } from '../src/client/ComposerDiscardAction.tsx'
import { ContextTrayDock } from '../src/client/ContextTrayDock.tsx'
import { ContextTray, type ContextTrayProps } from '../src/client/ContextTray.tsx'
import { GraphCanvas } from '../src/client/GraphCanvas.tsx'
import { GraphView } from '../src/client/GraphView.tsx'
import { ContextTrayChannel } from '../src/client/context-tray-channel.ts'
import { installLocaleSource } from '../src/client/i18n.ts'
import type { GraphState } from '../src/client/types.ts'
import { graph, node } from './fixtures.ts'

let uninstallLocale: (() => void) | undefined

afterEach(() => {
  cleanup()
  uninstallLocale?.()
  uninstallLocale = undefined
})

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

function previewFor(sources: readonly HistoryTurnSource[]): HistoryPreviewResponse {
  return {
    turns: sources.map((source, index) => ({
      source,
      targetTurn: index + 1,
      records: [
        {
          kind: 'user',
          seq: index * 2 + 1,
          messageId: `user-${index}`,
          content: [{ type: 'text', text: `Preview prompt ${source.sourceTurn}` }],
          source: { kind: 'user' },
        },
        {
          kind: 'assistant',
          seq: index * 2 + 2,
          step: 1,
          messageId: `assistant-${index}`,
          blocks: [{ type: 'text', text: `Preview answer ${source.sourceTurn}` }],
          provenance: { provider: 'test', model: 'test' },
        },
      ],
    })),
  }
}

function graphViewFixture(
  state: GraphState,
  input: { draft?: string; imageIds?: readonly string[]; occurrences?: readonly unknown[] } = {},
) {
  const sessionSnapshot = {
    chat: { timeline: { turnOrder: [], turns: new Map() } },
    nodes: [],
  }
  const inputSnapshot = {
    draft: input.draft ?? '',
    draftRev: 0,
    phase: 'plain',
    imageIds: input.imageIds ?? [],
    occurrences: input.occurrences ?? [],
  }
  const submit = vi.fn()
  const setComposerBlocked = vi.fn((_blocked: boolean) => true)
  const createMergedSession = vi.fn(async (
    _manifest: unknown, _draft: unknown, _signal: AbortSignal,
  ) => {})
  const loadHistoryPreview = vi.fn(async (sources: readonly HistoryTurnSource[]) => previewFor(sources))
  const tray = new ContextTrayChannel()
  const props = {
    sessionId: 'session-a',
    useSession: (selector: (value: unknown) => unknown) => selector(sessionSnapshot),
    useInput: (selector: (value: unknown) => unknown) => selector(inputSnapshot),
    inputActions: { submit },
    useGraph: (selector: (value: GraphState) => unknown) => selector(state),
    syncTurns: vi.fn(),
    adoptObservedGraph: vi.fn(),
    loadProjectGraph: vi.fn(async () => null),
    loadHistoryPreview,
    loadPreviewImage: vi.fn(async () => ({ url: 'blob:test', release: vi.fn() })),
    tray,
    setComposerBlocked,
    createMergedSession,
  }
  return { props, tray, submit, setComposerBlocked, createMergedSession, loadHistoryPreview }
}

type GraphViewFixture = ReturnType<typeof graphViewFixture>

function GraphViewHarness({ fixture }: { fixture: GraphViewFixture }) {
  const useTray: SnapshotSelectorHook<ContextTrayProps | null> = selector =>
    useSyncExternalStore(
      fixture.tray.subscribe,
      () => selector(fixture.tray.getSnapshot()),
      () => selector(fixture.tray.getSnapshot()),
    )
  return <>
    <GraphView {...(fixture.props as never)} />
    <ContextTrayDock {...({ useTray } as never)} />
    <ComposerDiscardAction {...({ useTray } as never)} />
  </>
}

function renderGraphView(fixture: GraphViewFixture) {
  return render(<GraphViewHarness fixture={fixture} />)
}

describe('graph UI', () => {
  const one = node({
    id: 'pa-11111920b5', prompt: 'Question one', createdAt: 1,
    turn: 1, boundarySeq: 5,
  })
  const two = node({
    id: 'pa-22222800af', prompt: 'Question two', createdAt: 2,
    turn: 2, boundarySeq: 10,
    primaryParentId: one.id, parentIds: [one.id],
    contextManifest: [one.id],
  })
  const three = node({
    id: 'pa-33333ca11d', sessionId: 'session-b', prompt: 'Question three', createdAt: 3,
    turn: 1, boundarySeq: 8,
    primaryParentId: null, parentIds: [], contextManifest: [],
  })
  const state = graph([one, two, three], {
    sessionTurnRefs: { 'session-a': { 1: one.id, 2: two.id }, 'session-b': { 1: three.id } },
  })

  it('renders compact PA nodes without exposing prompt text in the graph', () => {
    const preview = vi.fn()
    render(<GraphCanvas state={state} previewNodeId={null} onPreview={preview} />)
    expect(screen.getByText('HEAD')).toBeTruthy()
    expect(screen.queryByText('Question one')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看 PA1 context' }))
    expect(preview).toHaveBeenCalledWith(one.id)
  })

  it('toggles Conversation Graph from the button beside Chat History', () => {
    const view = renderGraphView(graphViewFixture(state))
    const chatHeading = screen.getByLabelText('Chat History').querySelector('.dsh-git-heading')
    const close = within(chatHeading as HTMLElement)
      .getByRole('button', { name: '关闭 Conversation Graph', expanded: true })

    expect(screen.getByLabelText('Conversation Graph')).toBeTruthy()
    fireEvent.click(close)

    expect(screen.queryByLabelText('Conversation Graph')).toBeNull()
    expect(view.container.querySelector('.dsh-git-workbench-graph-closed')).toBeTruthy()
    expect(view.container.querySelector('.dsh-git-chat-body-rail-expanded')).toBeTruthy()
    expect(view.container.querySelector('.dsh-git-rail-expanded')).toBeTruthy()
    expect(view.container.querySelectorAll('.dsh-git-rail-expanded-row')).toHaveLength(2)
    const historyTarget = document.createElement('section')
    historyTarget.id = `dsh-git-history-${two.id}`
    historyTarget.tabIndex = -1
    document.body.append(historyTarget)
    const scrollIntoView = vi.fn()
    historyTarget.scrollIntoView = scrollIntoView
    fireEvent.click(within(view.container.querySelector('.dsh-git-rail-expanded') as HTMLElement)
      .getByRole('button', { name: 'PA2 · Question two' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', inline: 'nearest' })
    expect(document.activeElement).toBe(historyTarget)
    historyTarget.remove()
    const open = within(chatHeading as HTMLElement)
      .getByRole('button', { name: '打开 Conversation Graph', expanded: false })
    fireEvent.click(open)

    expect(screen.getByLabelText('Conversation Graph')).toBeTruthy()
    expect(view.container.querySelector('.dsh-git-workbench-graph-closed')).toBeNull()
    expect(view.container.querySelector('.dsh-git-rail-expanded')).toBeNull()
    expect(view.container.querySelectorAll('.dsh-git-rail-dash')).toHaveLength(2)
  })

  it('keeps Context Tray compact until expanded, then exposes PA ordering controls', () => {
    const move = vi.fn()
    const tray = render(<ContextTray
      state={state}
      selectedIds={[one.id, two.id]}
      orderedIds={[one.id, two.id]}
      candidateId={null}
      busy={false}
      error={null}
      dirty={false}
      draftHasContent={false}
      overLimit={false}
      onMove={move}
      onMoveEnd={vi.fn()}
      onRemove={vi.fn()}
      onMerge={async () => {}}
      onDiscard={vi.fn()}
      onSendRefused={vi.fn()}
    />)
    expect(within(tray.container).getByText(/2 PA · 约 \d+ tokens/)).toBeTruthy()
    // Both PAs come from one Session, so the new Chat would fork it.
    expect(within(tray.container).getByRole('button', { name: 'Fork' })).toBeTruthy()
    expect(within(tray.container).getByRole('button', { expanded: false })).toBeTruthy()
    expect(within(tray.container).queryByText('PA1')).toBeNull()
    fireEvent.click(within(tray.container).getByRole('button', { name: '展开 Context Tray' }))
    expect(within(tray.container).getByText('PA1')).toBeTruthy()
    expect(within(tray.container).getByText('PA2')).toBeTruthy()
    expect(within(tray.container).queryByText('PA-920b5')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '将 PA2 向前移动' }))
    expect(move).toHaveBeenCalledWith(two.id, one.id)
  })

  it('renders no Context Tray surface for a clean empty selection', () => {
    const tray = render(<ContextTray
      state={state}
      selectedIds={[]}
      orderedIds={[]}
      candidateId={null}
      busy={false}
      error={null}
      dirty={false}
      draftHasContent={false}
      overLimit={false}
      onMove={vi.fn()}
      onMoveEnd={vi.fn()}
      onRemove={vi.fn()}
      onMerge={async () => {}}
      onDiscard={vi.fn()}
      onSendRefused={vi.fn()}
    />)
    expect(tray.container.innerHTML).toBe('')
  })

  it('auto-expands important dirty, candidate, and error states', () => {
    const common = {
      state,
      selectedIds: [one.id, two.id],
      busy: false,
      draftHasContent: false,
      overLimit: false,
      onMove: vi.fn(),
      onMoveEnd: vi.fn(),
      onRemove: vi.fn(),
      onMerge: async () => {},
      onDiscard: vi.fn(),
      onSendRefused: vi.fn(),
    }
    const tray = render(<ContextTray
      {...common}
      orderedIds={[one.id, two.id, three.id]}
      candidateId={three.id}
      error={null}
      dirty={false}
    />)
    expect((within(tray.container).getByRole('button', { expanded: true }) as HTMLButtonElement).disabled).toBe(true)
    // The preview joins the chips as a dashed chip; its prose lives in Chat History.
    expect(within(tray.container).queryByText(/绿色 PA 只是虚线预览/)).toBeNull()
    expect(within(tray.container).getByText(/2 PA \+ 1 预览 · 约 \d+ tokens/)).toBeTruthy()
    const candidateChip = tray.container.querySelector('[data-preview="candidate"]')
    expect(candidateChip?.textContent).toContain('PA3')
    expect(candidateChip?.className).toContain('dsh-git-chip-candidate')
    expect(within(tray.container).getByRole('button', { name: '关闭 PA3 预览' })).toBeTruthy()
    // PA3 comes from another Session: the preview already renames the action.
    expect(within(tray.container).getByRole('button', { name: 'Merge' })).toBeTruthy()
    // The preview reorders like any other chip.
    fireEvent.click(within(tray.container).getByRole('button', { name: '将 PA3 向前移动' }))
    expect(common.onMove).toHaveBeenCalledWith(three.id, two.id)

    tray.rerender(<ContextTray
      {...common}
      orderedIds={[one.id, two.id]}
      candidateId={null}
      error={null}
      dirty={true}
    />)
    expect(within(tray.container).getByRole('button', { name: 'Fork' })).toBeTruthy()
    expect((within(tray.container).getByRole('button', { expanded: true }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(tray.container).queryByText(/Context 有未 Merge 的更改/)).toBeNull()
    expect(within(tray.container).queryByRole('button', { name: /放弃更改/ })).toBeNull()

    tray.rerender(<ContextTray
      {...common}
      orderedIds={[one.id, two.id]}
      candidateId={null}
      error="preview failed"
      dirty={false}
    />)
    expect(within(tray.container).getByRole('alert').textContent).toBe('preview failed')
  })

  it('starts with the current Session history selected and keeps PA Context hidden', async () => {
    const fixture = graphViewFixture(state)
    const view = renderGraphView(fixture)

    expect(view.container.querySelector('[data-conversation-composer-overlay]')).toBeTruthy()
    expect(screen.queryByLabelText('PA Context Window')).toBeNull()
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected')
      expect(screen.getByRole('button', { name: '查看 PA2 context' }).getAttribute('data-selection-state')).toBe('selected')
    })
    expect(screen.getByRole('button', { name: '查看 PA3 context' }).getAttribute('data-selection-state')).toBe('unselected')
    await vi.waitFor(() => expect(view.container.querySelectorAll('[data-preview-state="selected"]')).toHaveLength(2))
    const rail = [...view.container.querySelectorAll('.dsh-git-rail-dash')]
    expect(rail.map(item => item.getAttribute('data-node-id'))).toEqual([one.id, two.id])
    expect(rail.map(item => item.getAttribute('data-rail-state')))
      .toEqual(['included', 'included'])
    expect(screen.getByText('Preview prompt 2')).toBeTruthy()
    expect(screen.getAllByRole('article', { name: '用户消息' })).toHaveLength(2)
    expect(screen.getAllByRole('article', { name: 'Assistant 消息' })).toHaveLength(2)
    expect(fixture.setComposerBlocked).not.toHaveBeenCalledWith(true)
  })

  it('previews a clicked PA as a green dashed candidate, then Add commits it', async () => {
    const fixture = graphViewFixture(state)
    const view = renderGraphView(fixture)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected'))

    const pa3 = screen.getByRole('button', { name: '查看 PA3 context' })
    fireEvent.click(pa3)

    expect(pa3.getAttribute('data-selection-state')).toBe('candidate')
    expect(pa3.getAttribute('aria-pressed')).toBe('mixed')
    expect(screen.getByLabelText('PA Context Window')).toBeTruthy()
    expect(screen.getByText('PA-ca11d')).toBeTruthy()
    expect(screen.getByText('2 已加入 + 1 预览')).toBeTruthy()
    expect([...view.container.querySelectorAll('.dsh-git-rail-dash')]
      .map(item => item.getAttribute('data-rail-state')))
      .toEqual(['included', 'included', 'preview'])
    // The compact PA rail carries the candidate state, and the tray shows the dashed chip.
    expect(within(screen.getByLabelText('Context Tray')).getByText('PA3')).toBeTruthy()
    expect(screen.getByLabelText('Context Tray').querySelector('[data-preview="candidate"]')).toBeTruthy()
    await vi.waitFor(() => {
      expect(screen.getByLabelText('PA3 · 虚线预览').getAttribute('data-preview-state')).toBe('candidate')
      expect(screen.getByText('虚线预览')).toBeTruthy()
    })
    // A merely unmerged Context leaves the official composer typable.
    expect(fixture.setComposerBlocked).not.toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: '关闭 PA Context Window' }))
    expect(document.activeElement).toBe(pa3)
    expect(screen.queryByLabelText('PA Context Window')).toBeNull()
    expect(pa3.getAttribute('data-selection-state')).toBe('unselected')
    expect([...view.container.querySelectorAll('.dsh-git-rail-dash')]
      .map(item => item.getAttribute('data-node-id')))
      .toEqual([one.id, two.id])
    fireEvent.click(pa3)

    fireEvent.click(screen.getByRole('button', { name: '加入 Context' }))
    expect(pa3.getAttribute('data-selection-state')).toBe('selected')
    expect(view.container.querySelector('[data-preview-state="candidate"]')).toBeNull()
    expect(screen.getByLabelText('Context Tray').querySelector('[data-preview="candidate"]')).toBeNull()
    // The Chat History header and the miniature trail share the same selection.
    const chatHeading = screen.getByLabelText('Chat History').querySelector('.dsh-git-heading')
    expect(within(chatHeading as HTMLElement).getByText('3 已加入')).toBeTruthy()
    expect(screen.getByRole('button', { name: '移出 Context' })).toBeTruthy()
  })

  it('reorders the dashed preview before it is added, and commits it in that place', async () => {
    const fixture = graphViewFixture(state)
    const view = renderGraphView(fixture)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected'))

    fireEvent.click(screen.getByRole('button', { name: '查看 PA3 context' }))
    const chipLabels = () => [...screen.getByLabelText('Context Tray').querySelectorAll('.dsh-git-chip')]
      .map(chip => chip.textContent?.replace(/[⠿⌁‹›×]|预览/g, '') ?? '')
    expect(chipLabels()).toEqual(['PA1', 'PA2', 'PA3'])

    fireEvent.click(screen.getByRole('button', { name: '将 PA3 向前移动' }))
    expect(chipLabels()).toEqual(['PA1', 'PA3', 'PA2'])
    expect(screen.getByLabelText('Context Tray').querySelector('[data-preview="candidate"]')?.textContent).toContain('PA3')
    // The moved preview stays a preview: still dashed in the history, still uncounted.
    expect(screen.getByText('2 已加入 + 1 预览')).toBeTruthy()
    await vi.waitFor(() => {
      const rail = [...view.container.querySelectorAll('.dsh-git-rail-dash')]
      expect(rail.map(item => item.getAttribute('data-node-id'))).toEqual([one.id, three.id, two.id])
      expect(rail.map(item => item.getAttribute('data-rail-state'))).toEqual(['included', 'preview', 'included'])
      const history = [...view.container.querySelectorAll('.dsh-git-preview-turn')]
      expect(history.map(item => item.getAttribute('data-node-id'))).toEqual([one.id, three.id, two.id])
      expect(history.map(item => item.getAttribute('data-preview-state'))).toEqual(['selected', 'candidate', 'selected'])
    })

    const candidateDash = view.container.querySelector(`.dsh-git-rail-dash[data-node-id="${three.id}"]`) as HTMLElement
    fireEvent.pointerEnter(candidateDash)
    expect(candidateDash.getAttribute('data-active')).toBe('')
    expect(view.container.querySelector(`.dsh-git-preview-turn[data-node-id="${three.id}"]`)?.getAttribute('data-rail-active')).toBe('')
    fireEvent.pointerLeave(view.container.querySelector('.dsh-git-rail') as HTMLElement)
    expect(view.container.querySelector(`.dsh-git-preview-turn[data-node-id="${three.id}"]`)?.getAttribute('data-rail-active')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '加入 Context' }))
    expect(chipLabels()).toEqual(['PA1', 'PA3', 'PA2'])
    expect(screen.getByLabelText('Context Tray').querySelector('[data-preview="candidate"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await vi.waitFor(() => expect(fixture.createMergedSession).toHaveBeenCalledWith(
      [one.id, three.id, two.id],
      expect.anything(),
      expect.any(AbortSignal),
    ))
  })

  it('Merge creates a new Chat with the ordered selection and never submits', async () => {
    const fixture = graphViewFixture(state, { draft: 'carry this official draft' })
    renderGraphView(fixture)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected'))
    fireEvent.click(screen.getByRole('button', { name: '查看 PA3 context' }))
    fireEvent.click(screen.getByRole('button', { name: '加入 Context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    await vi.waitFor(() => expect(fixture.createMergedSession).toHaveBeenCalledWith(
      [one.id, two.id, three.id],
      { text: 'carry this official draft', draftRevision: 0, imageIds: [], hasStructuredReferences: false },
      expect.any(AbortSignal),
    ))
    expect(fixture.submit).not.toHaveBeenCalled()
  })

  it('keeps a dirty composer typable and discard-and-send targets the source Session', async () => {
    const fixture = graphViewFixture(state, { draft: 'send from source' })
    renderGraphView(fixture)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA3 context' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '查看 PA3 context' }))

    await vi.waitFor(() => expect(screen.getByRole('button', { name: '放弃更改并发送' })).toBeTruthy())
    expect(fixture.setComposerBlocked).not.toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: '放弃更改并发送' }))

    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(1))
    expect(fixture.setComposerBlocked).toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: '查看 PA3 context' }).getAttribute('data-selection-state')).toBe('unselected')
  })

  it('does not bypass a foreign composer block when discarding context edits', async () => {
    const fixture = graphViewFixture(state, { draft: 'do not bypass safety' })
    fixture.setComposerBlocked.mockImplementation(() => false)
    renderGraphView(fixture)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA3 context' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '查看 PA3 context' }))

    fireEvent.click(screen.getByRole('button', { name: '放弃更改并发送' }))

    expect(fixture.submit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('来源 Session 仍被其他系统条件阻塞')
  })

  it('blocks a clean source composer while creation is busy and aborts navigation on unmount', async () => {
    const fixture = graphViewFixture(state, { draft: 'preserve me' })
    let signal: AbortSignal | undefined
    fixture.createMergedSession.mockImplementation(async (_manifest, _draft, nextSignal) => {
      signal = nextSignal
      await new Promise<void>((_resolve, reject) => {
        nextSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    const view = renderGraphView(fixture)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected'))

    // Single-Session selection: the action is a Fork, and its flight blocks the same way.
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }))
    await vi.waitFor(() => expect(fixture.setComposerBlocked).toHaveBeenCalledWith(true))
    expect(signal?.aborted).toBe(false)

    view.unmount()
    expect(signal?.aborted).toBe(true)
    expect(fixture.tray.getSnapshot()).toBeNull()
    expect(fixture.setComposerBlocked).toHaveBeenCalledWith(false)
  })

  it('follows a DSH locale change without rendering its own switch', () => {
    let localeSnapshot = { active: 'zh', revision: 0 }
    const listeners = new Set<() => void>()
    uninstallLocale = installLocaleSource({
      getSnapshot: () => localeSnapshot,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    })
    const fixture = graphViewFixture(state)
    renderGraphView(fixture)
    expect(screen.queryByLabelText('界面语言')).toBeNull()
    localeSnapshot = { active: 'en', revision: 1 }
    act(() => { for (const listener of listeners) listener() })
    expect(screen.getByText('Included')).toBeTruthy()
    expect(screen.getByText('Preview')).toBeTruthy()
    expect(screen.getByText(/2 PA · About \d+ tokens/)).toBeTruthy()
  })

  it('keeps the PA Context Window to number, title, hash, Context and the action', async () => {
    const fixture = graphViewFixture(state)
    renderGraphView(fixture)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected'))

    fireEvent.click(screen.getByRole('button', { name: '查看 PA3 context' }))
    const panel = screen.getByLabelText('PA Context Window')
    // Number, hash and the commit action share the heading bar.
    const heading = panel.querySelector('.dsh-git-heading') as HTMLElement
    expect(within(heading).getByText('PA3 Context')).toBeTruthy()
    expect(within(heading).getByText('PA-ca11d')).toBeTruthy()
    expect(within(heading).getByRole('button', { name: '加入 Context' })).toBeTruthy()
    expect(within(heading).getByRole('button', { name: '关闭 PA Context Window' })).toBeTruthy()
    expect(within(panel).getByRole('heading', { level: 3 }).textContent).toBe('Question three')
    expect(within(panel).getByLabelText('回答时使用的 Context')).toBeTruthy()
    // The prompt and answer bodies live in Chat History, not in this window.
    expect(within(panel).queryByText('PROMPT')).toBeNull()
    expect(within(panel).queryByText('ANSWER')).toBeNull()
  })
})
