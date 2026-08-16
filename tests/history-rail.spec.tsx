// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryRail } from '../src/client/HistoryRail.tsx'
import { EMPTY_HISTORY_RAIL, historyRailModel } from '../src/client/history-rail.ts'
import { STYLES } from '../src/client/styles.ts'
import { graph, node } from './fixtures.ts'

afterEach(cleanup)

const one = node({ id: 'pa-one', createdAt: 1, prompt: 'first question', answer: 'short' })
const two = node({
  id: 'pa-two', createdAt: 2, prompt: 'second question', answer: 'a much longer answer '.repeat(20),
  primaryParentId: one.id, parentIds: [one.id],
})
// A second child of the same parent: this is the branch off the spine.
const three = node({
  id: 'pa-three', createdAt: 3, prompt: 'branch question', answer: 'medium answer',
  primaryParentId: one.id, parentIds: [one.id],
})
const foreign = node({
  id: 'pa-foreign', createdAt: 4, sessionId: 'session-b', prompt: 'pulled in', answer: 'from elsewhere',
})
const state = graph([one, two, three, foreign])

describe('history rail model', () => {
  it('marks only included and preview nodes, leaving unselected nodes out', () => {
    const model = historyRailModel(state, {
      selectedIds: [one.id, two.id],
      candidateId: three.id,
      headNodeId: two.id,
    })

    expect(model.entries.map(entry => entry.label)).toEqual(['PA1', 'PA2', 'PA3'])
    expect(model.entries.map(entry => entry.state))
      .toEqual(['included', 'included', 'preview'])
    expect(model.entries.map(entry => entry.head)).toEqual([false, true, false])
    expect(model.includedCount).toBe(2)
    expect(model.previewCount).toBe(1)
  })

  it('lists a selected turn pulled in from another Session without unrelated nodes', () => {
    const model = historyRailModel(state, {
      selectedIds: [one.id, foreign.id],
      candidateId: null,
      headNodeId: one.id,
    })

    expect(model.entries.map(entry => entry.nodeId)).toEqual([one.id, foreign.id])
    expect(model.entries.every(entry => entry.state === 'included')).toBe(true)
  })

  it('matches the exact membership and order rendered by Chat History', () => {
    const model = historyRailModel(state, {
      selectedIds: [one.id, foreign.id],
      candidateId: null,
      headNodeId: one.id,
      orderedIds: [foreign.id, one.id],
    })

    expect(model.entries.map(entry => entry.nodeId)).toEqual([foreign.id, one.id])
    expect(model.entries.map(entry => entry.state)).toEqual(['included', 'included'])
  })

  it('keeps the included node blue and the inserted preview green', () => {
    const model = historyRailModel(state, {
      selectedIds: [one.id],
      candidateId: three.id,
      headNodeId: one.id,
      orderedIds: [one.id, three.id],
    })

    expect(model.entries.map(entry => entry.nodeId)).toEqual([one.id, three.id])
    expect(model.entries.map(entry => entry.state)).toEqual(['included', 'preview'])
    expect(model.includedCount).toBe(1)
    expect(model.previewCount).toBe(1)
  })

  it('indents a second child so a branch reads apart from the spine', () => {
    const model = historyRailModel(state, {
      selectedIds: [one.id, two.id, three.id],
      candidateId: null,
      headNodeId: null,
    })

    expect(model.entries.map(entry => entry.indent)).toEqual([0, 0, 1])
    expect(model.entries.map(entry => entry.branched)).toEqual([false, false, true])
  })

  it('does not draw an independent Session root as a branch', () => {
    const model = historyRailModel(state, {
      selectedIds: [one.id, foreign.id],
      candidateId: null,
      headNodeId: null,
    })

    expect(model.entries.map(entry => entry.indent)).toEqual([0, 0])
    expect(model.entries.map(entry => entry.branched)).toEqual([false, false])
  })

  it('does not count an unselected project fork marker as another PA', () => {
    const fork = node({
      id: 'pa-fork-marker', createdAt: 5, sessionId: 'session-c',
      forkSourceId: one.id, prompt: one.prompt, answer: one.answer,
    })
    const model = historyRailModel(graph([one, two, foreign, fork]), {
      selectedIds: [one.id],
      candidateId: null,
      headNodeId: two.id,
    })

    expect(model.entries.map(entry => entry.nodeId)).toEqual([one.id])
    expect(model.entries.map(entry => entry.state)).toEqual(['included'])
  })

  it('maps dash width from token weight and keeps it inside the rail column', () => {
    const model = historyRailModel(state, {
      selectedIds: [one.id, two.id, three.id],
      candidateId: null,
      headNodeId: null,
    })
    const widths = model.entries.map(entry => entry.width)

    expect(Math.min(...widths)).toBe(9)
    expect(Math.max(...widths)).toBe(18)
    // The heaviest turn is the one with the long answer.
    expect(model.entries[1]?.width).toBe(18)
  })

  it('collapses a candidate that is already committed, and an empty trail', () => {
    const committed = historyRailModel(state, {
      selectedIds: [one.id],
      candidateId: one.id,
      headNodeId: one.id,
    })

    expect(committed.entries.map(entry => entry.state)).toEqual(['included'])
    expect(committed.previewCount).toBe(0)
    expect(historyRailModel(graph([]), {
      selectedIds: [], candidateId: null, headNodeId: null,
    })).toEqual(EMPTY_HISTORY_RAIL)
  })
})

describe('HistoryRail presentation', () => {
  const model = historyRailModel(state, {
    selectedIds: [one.id],
    candidateId: three.id,
    headNodeId: one.id,
    orderedIds: [one.id, three.id],
  })

  it('renders exactly one stretchable dash per PA', () => {
    const select = vi.fn()
    const view = render(<HistoryRail {...model} onSelect={select} />)

    const dashes = [...view.container.querySelectorAll('.dsh-git-rail-dash')]
    expect(dashes.map(dash => dash.getAttribute('data-rail-state')))
      .toEqual(['included', 'preview'])
    expect(dashes[0]?.getAttribute('data-head')).toBe('')
    expect(dashes[1]?.getAttribute('aria-label')).toBe('PA3 · branch question')
    expect(view.container.querySelectorAll('.dsh-git-rail-state-line')).toHaveLength(2)
    expect(dashes[1]?.querySelector('.dsh-git-rail-state-line')).toBeTruthy()
    expect(view.container.querySelector('.dsh-git-rail-panel')).toBeNull()
    expect(view.container.querySelector('.dsh-git-rail-sum')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'PA3 · branch question' }))
    expect(select).toHaveBeenCalledWith(three.id)
  })

  it('maps included and preview dashes to blue and green tokens', () => {
    expect(STYLES).toContain('--dsh-git-state-included:var(--dsw-alias-state-business-primary,var(--dsw-static-deepseek-500,#4d6bfe))')
    expect(STYLES).toContain('--dsh-git-state-preview:var(--dsw-alias-state-success-primary,#1ec26a)')
    expect(STYLES).toContain('--dsh-git-state-excluded:var(--dsw-alias-line-secondary,#c9c9d0)')
    expect(STYLES).toContain('.dsh-git-rail-dash[data-rail-state="included"]{--dsh-git-rail-color:var(--dsh-git-state-included)}')
    expect(STYLES).toContain('.dsh-git-rail-dash[data-rail-state="preview"]{--dsh-git-rail-color:var(--dsh-git-state-preview)}')
    expect(STYLES).toContain('.dsh-git-rail-state-line{')
  })

  it('stretches only the pointed dash and activates the matching PA on the right', () => {
    const active = vi.fn()
    const view = render(<HistoryRail {...model} onSelect={vi.fn()} onActiveChange={active} />)
    const rail = view.container.querySelector('.dsh-git-rail') as HTMLElement
    const target = screen.getByRole('button', { name: 'PA3 · branch question' })

    fireEvent.pointerEnter(target)
    expect(target.getAttribute('data-active')).toBe('')
    expect(rail.getAttribute('data-active')).toBe('')
    expect(target.querySelector('.dsh-git-rail-copy')?.textContent).toContain('PA3')
    expect(active).toHaveBeenLastCalledWith(three.id)

    fireEvent.pointerLeave(rail)
    expect(target.getAttribute('data-active')).toBeNull()
    expect(active).toHaveBeenLastCalledWith(null)
  })

  it('costs no layout when the trail is empty, and stays inert while busy', () => {
    const empty = render(<HistoryRail {...EMPTY_HISTORY_RAIL} onSelect={vi.fn()} />)
    expect(empty.container.firstChild).toBeNull()
    empty.unmount()

    const select = vi.fn()
    render(<HistoryRail {...model} disabled onSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: 'PA1 · first question' }))
    expect(select).not.toHaveBeenCalled()
  })
})
