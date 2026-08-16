// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPreviewResponse, HistoryTurnSource } from '../src/protocol.ts'
import { ContextTray } from '../src/client/ContextTray.tsx'
import { GraphCanvas } from '../src/client/GraphCanvas.tsx'
import { GraphView } from '../src/client/GraphView.tsx'
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
          source: null,
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
    setComposerBlocked,
    createMergedSession,
  }
  return { props, submit, setComposerBlocked, createMergedSession, loadHistoryPreview }
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

  it('uses PA numbers in Context Tray and reserves hashes for the inspector', () => {
    const move = vi.fn()
    const tray = render(<ContextTray
      state={state}
      selectedIds={[one.id, two.id]}
      candidateId={null}
      busy={false}
      error={null}
      dirty={false}
      draftHasContent={false}
      overLimit={false}
      onMove={move}
      onMoveEnd={vi.fn()}
      onRemove={vi.fn()}
      onClear={vi.fn()}
      onMerge={async () => {}}
      onDiscard={vi.fn()}
    />)
    expect(within(tray.container).getByText('PA1')).toBeTruthy()
    expect(within(tray.container).getByText('PA2')).toBeTruthy()
    expect(within(tray.container).queryByText('PA-920b5')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '将 PA2 向前移动' }))
    expect(move).toHaveBeenCalledWith(two.id, one.id)
  })

  it('starts with the current Session history selected and keeps PA Context hidden', async () => {
    const fixture = graphViewFixture(state)
    const view = render(<GraphView {...(fixture.props as never)} />)

    expect(view.container.querySelector('[data-conversation-composer-overlay]')).toBeTruthy()
    expect(screen.queryByLabelText('PA Context Window')).toBeNull()
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected')
      expect(screen.getByRole('button', { name: '查看 PA2 context' }).getAttribute('data-selection-state')).toBe('selected')
    })
    expect(screen.getByRole('button', { name: '查看 PA3 context' }).getAttribute('data-selection-state')).toBe('unselected')
    await vi.waitFor(() => expect(view.container.querySelectorAll('[data-preview-state="selected"]')).toHaveLength(2))
    expect(screen.getByText('Preview prompt 2')).toBeTruthy()
    expect(screen.getAllByRole('article', { name: '用户消息' })).toHaveLength(2)
    expect(screen.getAllByRole('article', { name: 'Assistant 消息' })).toHaveLength(2)
    expect(fixture.setComposerBlocked).not.toHaveBeenCalledWith(true)
  })

  it('previews a clicked PA as a green dashed candidate, then Add commits it', async () => {
    const fixture = graphViewFixture(state)
    const view = render(<GraphView {...(fixture.props as never)} />)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected'))

    const pa3 = screen.getByRole('button', { name: '查看 PA3 context' })
    fireEvent.click(pa3)

    expect(pa3.getAttribute('data-selection-state')).toBe('candidate')
    expect(pa3.getAttribute('aria-pressed')).toBe('mixed')
    expect(screen.getByLabelText('PA Context Window')).toBeTruthy()
    expect(screen.getByText('PA-ca11d')).toBeTruthy()
    expect(screen.getByText('2 已加入 + 1 预览')).toBeTruthy()
    await vi.waitFor(() => {
      expect(view.container.querySelector('[data-preview-state="candidate"]')).toBeTruthy()
      expect(screen.getByText('虚线预览')).toBeTruthy()
    })
    expect(fixture.setComposerBlocked).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: '关闭 PA Context Window' }))
    expect(document.activeElement).toBe(pa3)
    expect(screen.queryByLabelText('PA Context Window')).toBeNull()
    expect(pa3.getAttribute('data-selection-state')).toBe('unselected')
    fireEvent.click(pa3)

    fireEvent.click(screen.getByRole('button', { name: '加入 Context' }))
    expect(pa3.getAttribute('data-selection-state')).toBe('selected')
    expect(view.container.querySelector('[data-preview-state="candidate"]')).toBeNull()
    expect(screen.getByText('3 已加入')).toBeTruthy()
    expect(screen.getByRole('button', { name: '移出 Context' })).toBeTruthy()
  })

  it('Merge creates a new Chat with the ordered selection and never submits', async () => {
    const fixture = graphViewFixture(state, { draft: 'carry this official draft' })
    render(<GraphView {...(fixture.props as never)} />)
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

  it('dirty selection blocks the composer and discard-and-send targets the source Session', async () => {
    const fixture = graphViewFixture(state, { draft: 'send from source' })
    render(<GraphView {...(fixture.props as never)} />)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA3 context' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '查看 PA3 context' }))

    await vi.waitFor(() => expect(fixture.setComposerBlocked).toHaveBeenCalledWith(true))
    fireEvent.click(screen.getByRole('button', { name: '放弃更改并发送原会话' }))

    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledTimes(1))
    expect(fixture.setComposerBlocked).toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: '查看 PA3 context' }).getAttribute('data-selection-state')).toBe('unselected')
  })

  it('does not bypass a foreign composer block when discarding context edits', async () => {
    const fixture = graphViewFixture(state, { draft: 'do not bypass safety' })
    fixture.setComposerBlocked.mockImplementation(() => false)
    render(<GraphView {...(fixture.props as never)} />)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA3 context' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '查看 PA3 context' }))

    fireEvent.click(screen.getByRole('button', { name: '放弃更改并发送原会话' }))

    expect(fixture.submit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('来源 Session 仍被其他系统条件阻塞')
  })

  it('blocks a clean source composer while Merge is busy and aborts navigation on unmount', async () => {
    const fixture = graphViewFixture(state, { draft: 'preserve me' })
    let signal: AbortSignal | undefined
    fixture.createMergedSession.mockImplementation(async (_manifest, _draft, nextSignal) => {
      signal = nextSignal
      await new Promise<void>((_resolve, reject) => {
        nextSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    const view = render(<GraphView {...(fixture.props as never)} />)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected'))

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await vi.waitFor(() => expect(fixture.setComposerBlocked).toHaveBeenCalledWith(true))
    expect(signal?.aborted).toBe(false)

    view.unmount()
    expect(signal?.aborted).toBe(true)
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
    render(<GraphView {...(fixture.props as never)} />)
    expect(screen.queryByLabelText('界面语言')).toBeNull()
    localeSnapshot = { active: 'en', revision: 1 }
    act(() => { for (const listener of listeners) listener() })
    expect(screen.getByText('Blue: included · green: preview')).toBeTruthy()
    expect(screen.getByText(/Merge only creates a new Chat/)).toBeTruthy()
  })

  it('renders prompt and answer Markdown in the PA Context Window', async () => {
    const markdownNode = node({
      id: 'pa-markdown',
      prompt: '## Prompt heading\n\nUse **rendered text**.',
      answer: 'Answer with `inline code` and:\n\n- first item\n- second item',
      createdAt: 1,
    })
    const markdownState = graph([markdownNode], {
      sessionTurnRefs: { 'session-a': { 1: markdownNode.id } },
    })
    const fixture = graphViewFixture(markdownState)
    render(<GraphView {...(fixture.props as never)} />)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '查看 PA1 context' }).getAttribute('data-selection-state')).toBe('selected'))

    fireEvent.click(screen.getByRole('button', { name: '查看 PA1 context' }))
    const panel = screen.getByLabelText('PA Context Window')
    expect(within(panel).getByRole('heading', { level: 2, name: 'Prompt heading' })).toBeTruthy()
    expect(within(panel).getByText('rendered text').tagName).toBe('STRONG')
    expect(within(panel).getByText('inline code').tagName).toBe('CODE')
    expect(within(panel).getByRole('list').children).toHaveLength(2)
  })
})
