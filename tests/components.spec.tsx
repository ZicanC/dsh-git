// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextTray } from '../src/client/ContextTray.tsx'
import { GraphCanvas } from '../src/client/GraphCanvas.tsx'
import { GraphView } from '../src/client/GraphView.tsx'
import { graph, node } from './fixtures.ts'

afterEach(cleanup)

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

describe('graph UI', () => {
  const one = node({ id: 'pa1', prompt: 'Question one', createdAt: 1 })
  const two = node({
    id: 'pa2', prompt: 'Question two', createdAt: 2,
    primaryParentId: 'pa1', parentIds: ['pa1'],
    contextManifest: ['pa1'],
  })
  const state = graph([one, two])

  it('renders compact PA nodes without exposing prompt text in the graph', () => {
    const preview = vi.fn()
    render(<GraphCanvas state={state} previewNodeId={null} onPreview={preview} />)
    expect(screen.getByText('HEAD')).toBeTruthy()
    expect(screen.queryByText('Question one')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看 PA1 context' }))
    expect(preview).toHaveBeenCalledWith('pa1')
  })

  it('keeps the context panel hidden until a graph node is clicked', () => {
    const snapshot = {
      chat: { timeline: { turnOrder: [], turns: new Map() } },
      nodes: [],
    }
    const view = render(<GraphView {...({
      useSession: (selector: (value: unknown) => unknown) => selector(snapshot),
      useGraph: (selector: (value: unknown) => unknown) => selector(state),
      syncTurns: vi.fn(), toggleContext: vi.fn(), moveContext: vi.fn(),
      moveContextToEnd: vi.fn(), clearContext: vi.fn(), checkout: vi.fn(),
      renameBranch: vi.fn(), ask: vi.fn(),
    } as never)} />)
    expect(view.container.querySelector('[data-conversation-composer-overlay]')).toBeTruthy()
    expect(screen.queryByLabelText('节点 Context')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看 PA2 context' }))
    expect(screen.getByLabelText('节点 Context')).toBeTruthy()
    expect(screen.getByText('回答时使用的 CONTEXT')).toBeTruthy()
    expect(within(screen.getByLabelText('回答时使用的 Context')).getByText('Question one')).toBeTruthy()
    expect(screen.getAllByText('Question two')).toHaveLength(2)
  })

  it('keeps the question when branch creation fails and displays the supplied error', async () => {
    const ask = vi.fn(() => Promise.reject(new Error('failed')))
    const { rerender } = render(<ContextTray
      state={state} busy={false} error={null}
      onMove={vi.fn()} onMoveEnd={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} onAsk={ask}
    />)
    const input = screen.getByPlaceholderText(/输入下一个问题/) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'new question' } })
    fireEvent.click(screen.getByText(/创建 merge branch/))
    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith('new question'))
    rerender(<ContextTray
      state={state} busy={false} error="failed"
      onMove={vi.fn()} onMoveEnd={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} onAsk={ask}
    />)
    expect(input.value).toBe('new question')
    expect(screen.getByRole('alert').textContent).toBe('failed')
  })
})
