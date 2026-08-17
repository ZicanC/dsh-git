// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ChatHistoryPreview,
  type ChatHistoryPreviewProps,
} from '../src/client/ChatHistoryPreview.tsx'
import { installLocaleSource } from '../src/client/i18n.ts'
import { STYLES } from '../src/client/styles.ts'
import type { HistoryPreviewRecord, HistoryPreviewResponse } from '../src/protocol.ts'
import type { TurnNodeId } from '../src/client/types.ts'

interface PreviewTurn {
  readonly id: TurnNodeId
  readonly label: string
  readonly records: readonly HistoryPreviewRecord[]
}

const firstId = 'pa-preview-first' as TurnNodeId
const secondId = 'pa-preview-second' as TurnNodeId

const unavailableImage: ChatHistoryPreviewProps['loadImage'] = async () => {
  throw new Error('this fixture has no images')
}

let uninstallLocale: (() => void) | undefined

beforeEach(() => {
  const snapshot = Object.freeze({ active: 'en', revision: 1 })
  uninstallLocale = installLocaleSource({
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  })
})

afterEach(() => {
  cleanup()
  uninstallLocale?.()
  uninstallLocale = undefined
})

function renderTurns(
  turns: readonly PreviewTurn[],
  candidateNodeId: TurnNodeId | null = null,
  activeNodeId: TurnNodeId | null = null,
) {
  const response: HistoryPreviewResponse = {
    turns: turns.map((turn, index) => ({
      source: {
        sourceSessionId: `source-session-${index + 1}`,
        sourceTurn: index + 1,
        sourceBoundarySeq: (index + 1) * 10,
      },
      targetTurn: index + 1,
      records: turn.records,
    })),
  }
  return render(<ChatHistoryPreview
    response={response}
    orderedNodeIds={turns.map(turn => turn.id)}
    labels={new Map(turns.map(turn => [turn.id, turn.label]))}
    candidateNodeId={candidateNodeId}
    activeNodeId={activeNodeId}
    loading={false}
    error={null}
    loadImage={unavailableImage}
  />)
}

describe('ChatHistoryPreview official-style projection', () => {
  it('renders an ordinary user as an article and non-user source as a Context injection disclosure', () => {
    const view = renderTurns([{
      id: firstId,
      label: 'PA1',
      records: [
        {
          kind: 'user',
          seq: 1,
          messageId: 'ordinary-user',
          content: [{ type: 'text', text: 'ordinary prompt' }],
          source: { kind: 'user' },
        },
        {
          kind: 'user',
          seq: 2,
          messageId: 'plugin-context',
          content: [{ type: 'text', text: 'injected workspace guidance' }],
          source: { kind: 'plugin', plugin: 'workspace-rules' },
        },
      ],
    }])

    const user = screen.getByRole('article', { name: 'User message' })
    expect(within(user).getByText('ordinary prompt')).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(1)

    const context = screen.getByRole('button', { name: /Context injection/ })
    expect(context.getAttribute('aria-expanded')).toBe('false')
    expect(context.textContent).toContain('workspace-rules')
    expect(view.container.querySelector('.dsh-git-preview-context-body')).toBeNull()
  })

  it('does not expose request header or request context metadata in the DOM', () => {
    const view = renderTurns([{
      id: firstId,
      label: 'PA1',
      records: [
        {
          kind: 'request',
          seq: 1,
          requestKind: 'header',
          data: { system: 'super-secret-system-prompt' },
        },
        {
          kind: 'request',
          seq: 2,
          requestKind: 'context',
          data: { internal: 'hidden-provider-context' },
        },
      ],
    }])

    expect(view.container.textContent).not.toContain('super-secret-system-prompt')
    expect(view.container.textContent).not.toContain('hidden-provider-context')
    expect(screen.queryByText('Request')).toBeNull()
    expect(screen.queryByText('Context')).toBeNull()
  })

  it('keeps Think collapsed by default and supports both click and Enter expansion', () => {
    const view = renderTurns([{
      id: firstId,
      label: 'PA1',
      records: [{
        kind: 'assistant',
        seq: 1,
        step: 1,
        messageId: 'assistant-reasoning',
        blocks: [{ type: 'reasoning', text: 'Reasoning summary\nHidden reasoning detail' }],
        provenance: { provider: 'test', model: 'test' },
      }],
    }])

    const think = screen.getByRole('button', { name: /Think/ })
    expect(think.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('.dsh-git-preview-reasoning-body')).toBeNull()

    fireEvent.click(think)
    expect(think.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('.dsh-git-preview-reasoning-body')?.textContent)
      .toBe('Reasoning summary\nHidden reasoning detail')

    fireEvent.click(think)
    expect(think.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('.dsh-git-preview-reasoning-body')).toBeNull()

    fireEvent.keyDown(think, { key: 'Enter', code: 'Enter' })
    expect(think.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('.dsh-git-preview-reasoning-body')).toBeTruthy()
  })

  it('folds a matching tool call and result into one disclosure with details only when expanded', () => {
    const view = renderTurns([{
      id: firstId,
      label: 'PA1',
      records: [
        {
          kind: 'tool-call',
          seq: 1,
          step: 1,
          callId: 'shared-call-id',
          name: 'read',
          arguments: '{"path":"notes/demo.txt"}',
        },
        {
          kind: 'tool-result',
          seq: 2,
          step: 1,
          callId: 'shared-call-id',
          content: [{ type: 'text', text: 'file body' }],
          isError: false,
        },
      ],
    }])

    const rows = view.container.querySelectorAll('.dsh-git-preview-tool-row')
    expect(rows).toHaveLength(1)
    const row = rows[0] as HTMLElement
    const disclosure = within(row).getByRole('button', { name: /read/i })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(row.textContent).not.toContain('shared-call-id')
    expect(within(row).queryByText('IN')).toBeNull()
    expect(within(row).queryByText('OUT')).toBeNull()

    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(within(row).getByText('IN')).toBeTruthy()
    expect(within(row).getByText('OUT')).toBeTruthy()
    expect(row.textContent).toContain('file body')
    expect(row.textContent).not.toContain('shared-call-id')
  })

  it('exposes selected and candidate PA rails through data and accessible state labels', () => {
    renderTurns([
      { id: firstId, label: 'PA1', records: [] },
      { id: secondId, label: 'PA2', records: [] },
    ], secondId)

    const selected = screen.getByLabelText('PA1 · included')
    const candidate = screen.getByLabelText('PA2 · dashed preview')
    expect(selected.getAttribute('data-preview-state')).toBe('selected')
    expect(selected.getAttribute('aria-label')).toBe('PA1 · included')
    expect(candidate.getAttribute('data-preview-state')).toBe('candidate')
    expect(candidate.getAttribute('aria-label')).toBe('PA2 · dashed preview')
    expect(STYLES).toContain('.dsh-git-preview-turn[data-preview-state="selected"]{border-inline-start:2px solid var(--dsh-git-state-included)}')
    expect(STYLES).toContain('.dsh-git-preview-turn[data-preview-state="candidate"]{border-inline-start:2px dashed var(--dsh-git-state-preview)}')
  })

  it('marks the PA activated by the matching history-rail dash', () => {
    renderTurns([
      { id: firstId, label: 'PA1', records: [] },
      { id: secondId, label: 'PA2', records: [] },
    ], null, secondId)

    expect(screen.getByLabelText('PA1 · included').getAttribute('data-rail-active')).toBeNull()
    expect(screen.getByLabelText('PA2 · included').getAttribute('data-rail-active')).toBe('')
  })

  it('keeps orphan results, turn status, and future events accessible', () => {
    const view = renderTurns([{
      id: firstId,
      label: 'PA1',
      records: [
        {
          kind: 'tool-result',
          seq: 1,
          step: 1,
          callId: 'orphan-call-id',
          content: [{ type: 'text', text: 'orphan output' }],
          isError: false,
        },
        {
          kind: 'turn-status',
          seq: 2,
          status: 'max-tokens',
          details: { kind: 'max-tokens' },
        },
        {
          kind: 'event',
          seq: 3,
          eventType: 'future/event',
          data: { value: 'future payload' },
        },
      ],
    }])

    const orphan = screen.getByRole('button', { name: /Tool/ })
    expect(orphan.getAttribute('aria-expanded')).toBe('false')
    expect(orphan.textContent).toContain('orphan output')
    expect(view.container.textContent).not.toContain('orphan-call-id')

    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Maximum tokens reached')
    expect(status.textContent).toContain('max-tokens')

    const event = screen.getByRole('button', { name: 'future/event' })
    expect(event.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.textContent).not.toContain('future payload')
    fireEvent.click(event)
    expect(event.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.textContent).toContain('future payload')
  })

  it('keeps settled PAs on screen while an unread PA fills in, then streams a live tail', () => {
    const response: HistoryPreviewResponse = {
      turns: [
        {
          source: { sourceSessionId: 'source-session-1', sourceTurn: 1, sourceBoundarySeq: 10 },
          targetTurn: 1,
          records: [{
            kind: 'user',
            seq: 1,
            messageId: 'settled',
            content: [{ type: 'text', text: 'settled prompt' }],
            source: { kind: 'user' },
          }],
        },
        {
          source: { sourceSessionId: 'source-session-2', sourceTurn: 2, sourceBoundarySeq: 20 },
          targetTurn: 2,
          records: [],
        },
      ],
    }
    const view = render(<ChatHistoryPreview
      response={response}
      orderedNodeIds={[firstId, secondId]}
      labels={new Map([[firstId, 'PA1'], [secondId, 'PA2']])}
      candidateNodeId={null}
      activeNodeId={null}
      pendingNodeIds={new Set([secondId])}
      liveTurns={[{
        key: 'live-turn:3',
        label: 'Turn 3',
        sourceSessionId: 'source-session-1',
        records: [{
          kind: 'assistant',
          seq: 9,
          step: 1,
          messageId: 'live',
          blocks: [{ type: 'text', text: 'streaming words' }],
          provenance: { provider: '', model: '' },
        }],
      }]}
      loading
      error={null}
      loadImage={unavailableImage}
    />)

    // The settled PA renders, the unread one announces itself, and neither is
    // replaced by a full-panel loading state.
    expect(screen.getByText('settled prompt')).toBeTruthy()
    const pending = view.container.querySelector(`[data-node-id="${secondId}"]`) as HTMLElement
    expect(pending.getAttribute('aria-busy')).toBe('true')
    expect(within(pending).getByRole('status').textContent).toContain('Loading this PA')

    const live = view.container.querySelector('[data-preview-state="live"]') as HTMLElement
    expect(within(live).getByText('streaming words')).toBeTruthy()
    expect(live.getAttribute('aria-label')).toBe('Turn 3 · streaming')
    expect(live.getAttribute('data-node-id')).toBeNull()
  })

  it('renders a live tail with no selected PA instead of the empty-selection hint', () => {
    render(<ChatHistoryPreview
      response={null}
      orderedNodeIds={[]}
      labels={new Map()}
      candidateNodeId={null}
      activeNodeId={null}
      liveTurns={[{
        key: 'live-turn:1',
        label: 'Turn 1',
        sourceSessionId: 'source-session-1',
        records: [{
          kind: 'user',
          seq: 1,
          messageId: 'live-user',
          content: [{ type: 'text', text: 'first question' }],
          source: { kind: 'user' },
        }],
      }]}
      loading={false}
      error={null}
      loadImage={unavailableImage}
    />)

    expect(screen.queryByText(/Select PAs to preview/)).toBeNull()
    expect(screen.getByText('first question')).toBeTruthy()
    expect(screen.getByLabelText('Turn 1 · streaming')).toBeTruthy()
  })
})

/** jsdom has no layout: the observer and the scroll metrics are supplied here. */
class TestResizeObserver {
  static instances: TestResizeObserver[] = []
  readonly targets: Element[] = []
  constructor(readonly notify: () => void) { TestResizeObserver.instances.push(this) }
  observe(target: Element): void { this.targets.push(target) }
  unobserve(): void {}
  disconnect(): void { this.targets.length = 0 }
}

function measure(element: HTMLElement, scrollHeight: number, clientHeight = 400): void {
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
}

function liveTurn(turn: number, text: string): NonNullable<ChatHistoryPreviewProps['liveTurns']>[number] {
  return {
    key: `live-turn:${turn}`,
    label: `Turn ${turn}`,
    sourceSessionId: 'source-session-1',
    records: [{
      kind: 'assistant',
      seq: 9,
      step: 1,
      messageId: `live-${turn}`,
      blocks: [{ type: 'text', text }],
      provenance: { provider: '', model: '' },
    }],
  }
}

const settled: HistoryPreviewResponse = {
  turns: [{
    source: { sourceSessionId: 'source-session-1', sourceTurn: 1, sourceBoundarySeq: 10 },
    targetTurn: 1,
    records: [{
      kind: 'user',
      seq: 1,
      messageId: 'settled',
      content: [{ type: 'text', text: 'settled prompt' }],
      source: { kind: 'user' },
    }],
  }],
}

describe('ChatHistoryPreview scroll follow', () => {
  beforeEach(() => {
    TestResizeObserver.instances = []
    Reflect.set(globalThis, 'ResizeObserver', TestResizeObserver)
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  function renderFollow(liveTurns: ChatHistoryPreviewProps['liveTurns'], response = settled) {
    return render(<ChatHistoryPreview
      response={response}
      orderedNodeIds={[firstId]}
      labels={new Map([[firstId, 'PA1']])}
      candidateNodeId={null}
      activeNodeId={null}
      liveTurns={liveTurns}
      loading={false}
      error={null}
      loadImage={unavailableImage}
    />)
  }

  it('follows a streaming turn to the floor and stops once the reader scrolls up', () => {
    const view = renderFollow([liveTurn(1, 'first token')])
    const scroller = view.container.querySelector('.dsh-git-chat-history') as HTMLElement
    const observer = TestResizeObserver.instances.at(-1)
    expect(observer?.targets).toContain(view.container.querySelector('.dsh-git-preview-column'))

    // Streaming grows the column: the pinned reader rides it down.
    measure(scroller, 1200)
    observer?.notify()
    expect(scroller.scrollTop).toBe(1200)

    // Reading history detaches the follow, and the way back is offered.
    scroller.scrollTop = 0
    fireEvent.scroll(scroller)
    expect(screen.getByRole('button', { name: 'Back to bottom' })).toBeTruthy()
    measure(scroller, 1600)
    observer?.notify()
    expect(scroller.scrollTop).toBe(0)

    // Back to bottom re-attaches it.
    fireEvent.click(screen.getByRole('button', { name: 'Back to bottom' }))
    expect(scroller.scrollTop).toBe(1600)
    measure(scroller, 1900)
    observer?.notify()
    expect(scroller.scrollTop).toBe(1900)
  })

  it('lands on a newly submitted turn even when the reader had scrolled up', () => {
    const view = renderFollow([liveTurn(1, 'first token')])
    const scroller = view.container.querySelector('.dsh-git-chat-history') as HTMLElement
    measure(scroller, 1200)
    scroller.scrollTop = 0
    fireEvent.scroll(scroller)
    expect(scroller.scrollTop).toBe(0)

    view.rerender(<ChatHistoryPreview
      response={settled}
      orderedNodeIds={[firstId]}
      labels={new Map([[firstId, 'PA1']])}
      candidateNodeId={null}
      activeNodeId={null}
      liveTurns={[liveTurn(1, 'first token'), liveTurn(2, 'just submitted')]}
      loading={false}
      error={null}
      loadImage={unavailableImage}
    />)

    expect(scroller.scrollTop).toBe(1200)
    expect(screen.queryByRole('button', { name: 'Back to bottom' })).toBeNull()
  })

  it('observes the flow that mounts after the initial loading status view', () => {
    const view = render(<ChatHistoryPreview
      response={null}
      orderedNodeIds={[]}
      labels={new Map()}
      candidateNodeId={null}
      activeNodeId={null}
      loading
      error={null}
      loadImage={unavailableImage}
    />)
    expect(view.container.querySelector('.dsh-git-chat-history')).toBeNull()

    view.rerender(<ChatHistoryPreview
      response={settled}
      orderedNodeIds={[firstId]}
      labels={new Map([[firstId, 'PA1']])}
      candidateNodeId={null}
      activeNodeId={null}
      liveTurns={[liveTurn(1, 'first token')]}
      loading={false}
      error={null}
      loadImage={unavailableImage}
    />)

    const scroller = view.container.querySelector('.dsh-git-chat-history') as HTMLElement
    const observer = TestResizeObserver.instances.at(-1)
    expect(observer?.targets).toContain(view.container.querySelector('.dsh-git-preview-column'))
    measure(scroller, 800)
    observer?.notify()
    expect(scroller.scrollTop).toBe(800)
  })
})
