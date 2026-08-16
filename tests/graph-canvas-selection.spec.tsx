// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphCanvas } from '../src/client/GraphCanvas.tsx'
import { STYLES } from '../src/client/styles.ts'
import { graph, node } from './fixtures.ts'

afterEach(cleanup)

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

describe('GraphCanvas selection presentation', () => {
  const one = node({ id: 'pa-selection-one', createdAt: 1 })
  const two = node({
    id: 'pa-selection-two', createdAt: 2,
    primaryParentId: one.id, parentIds: [one.id],
  })
  const three = node({
    id: 'pa-selection-three', createdAt: 3,
    primaryParentId: two.id, parentIds: [two.id],
  })
  const state = graph([one, two, three])

  it('exposes committed, candidate, and unselected states without changing preview clicks', () => {
    const preview = vi.fn()
    render(<GraphCanvas
      state={state}
      previewNodeId={two.id}
      onPreview={preview}
      selectedNodeIds={[one.id]}
      candidateNodeId={two.id}
    />)

    const selected = screen.getByRole('button', { name: '查看 PA1 context' })
    const candidate = screen.getByRole('button', { name: '查看 PA2 context' })
    const unselected = screen.getByRole('button', { name: '查看 PA3 context' })

    expect(selected.classList.contains('dsh-git-tree-node-selected')).toBe(true)
    expect(selected.dataset.selectionState).toBe('selected')
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(candidate.classList.contains('dsh-git-tree-node-candidate')).toBe(true)
    expect(candidate.classList.contains('dsh-git-tree-node-preview')).toBe(true)
    expect(candidate.dataset.selectionState).toBe('candidate')
    expect(candidate.getAttribute('aria-pressed')).toBe('mixed')
    expect(candidate.getAttribute('aria-controls')).toBe('dsh-git-pa-context-window')
    expect(candidate.getAttribute('aria-expanded')).toBe('true')
    expect(unselected.dataset.selectionState).toBe('unselected')
    expect(unselected.getAttribute('aria-pressed')).toBe('false')
    expect(unselected.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(candidate)
    expect(preview).toHaveBeenCalledWith(two.id)
  })

  it('keeps legacy callers free of toggle-button semantics', () => {
    render(<GraphCanvas state={state} previewNodeId={null} onPreview={vi.fn()} />)

    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('aria-pressed')).toBe(false)
      expect(button.hasAttribute('aria-controls')).toBe(false)
      expect(button.hasAttribute('aria-expanded')).toBe(false)
      expect(button.hasAttribute('data-selection-state')).toBe(false)
      expect(button.classList.contains('dsh-git-tree-node-selected')).toBe(false)
      expect(button.classList.contains('dsh-git-tree-node-candidate')).toBe(false)
    }
  })

  it('keeps a committed node selected if a caller also passes it as the candidate', () => {
    render(<GraphCanvas
      state={state}
      previewNodeId={one.id}
      onPreview={vi.fn()}
      selectedNodeIds={[one.id]}
      candidateNodeId={one.id}
    />)

    const button = screen.getByRole('button', { name: '查看 PA1 context' })
    expect(button.classList.contains('dsh-git-tree-node-selected')).toBe(true)
    expect(button.classList.contains('dsh-git-tree-node-candidate')).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('binds every workbench selection state to an explicit gray, blue, or green rule', () => {
    expect(STYLES).toContain('.dsh-git-tree-node[data-selection-state="unselected"]{border-inline-start:2px solid var(--dsh-git-state-excluded)')
    expect(STYLES).toContain('.dsh-git-tree-node[data-selection-state="selected"]{border-inline-start:2px solid var(--dsh-git-state-included)')
    expect(STYLES).toContain('.dsh-git-tree-node[data-selection-state="candidate"]{border-inline-start:2px dashed var(--dsh-git-state-preview)')
    expect(STYLES).toContain('.dsh-git-tree-node:not([data-selection-state])[style*="--dsh-git-node-color"]{border-inline-start:4px solid var(--dsh-git-node-color)}')
  })
})
