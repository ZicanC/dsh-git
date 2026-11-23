// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphCanvas, MAX_SCALE, MIN_SCALE } from '../src/client/GraphCanvas.tsx'
import { ProjectGraphPage } from '../src/client/ProjectGraphPage.tsx'
import { graph, node } from './fixtures.ts'
import type { ProjectGraphResponse } from '../src/protocol.ts'

class ZoomResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ZoomResizeObserver)

// jsdom ships no PointerEvent, so Testing Library would otherwise degrade
// pointer gestures to bare Events without a button or coordinates.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number

  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
  }
}
vi.stubGlobal('PointerEvent', TestPointerEvent)

const VIEWPORT_WIDTH = 600
const VIEWPORT_HEIGHT = 400

/** jsdom reports every box as 0×0; the canvas needs a measurable viewport. */
function stubViewportSize(): void {
  for (const [property, value] of [['clientWidth', VIEWPORT_WIDTH], ['clientHeight', VIEWPORT_HEIGHT]] as const) {
    Object.defineProperty(HTMLElement.prototype, property, { configurable: true, value })
  }
}

function restoreViewportSize(): void {
  for (const property of ['clientWidth', 'clientHeight']) {
    Reflect.deleteProperty(HTMLElement.prototype, property)
  }
}

interface StageView {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly width: number
  readonly height: number
}

function stageView(): StageView {
  const stage = document.querySelector('.dsh-git-tree-stage') as HTMLElement
  const transform = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(stage.style.transform)
  if (transform === null) throw new Error(`unreadable stage transform: ${stage.style.transform}`)
  return {
    x: Number(transform[1]), y: Number(transform[2]), scale: Number(transform[3]),
    width: Number.parseFloat(stage.style.width), height: Number.parseFloat(stage.style.height),
  }
}

function readout(): number {
  return Number.parseInt(document.querySelector('.dsh-git-tree-zoom-value')!.textContent!, 10)
}

function viewport(): HTMLElement {
  return document.querySelector('.dsh-git-tree-viewport') as HTMLElement
}

beforeEach(stubViewportSize)
afterEach(() => { cleanup(); restoreViewportSize() })

describe('GraphCanvas pan and zoom', () => {
  const one = node({ id: 'pa-zoom-one', createdAt: 1 })
  const two = node({
    id: 'pa-zoom-two', createdAt: 2, primaryParentId: one.id, parentIds: [one.id],
  })
  const state = graph([one, two])

  const renderCanvas = (): void => {
    render(<GraphCanvas state={state} previewNodeId={null} onPreview={vi.fn()} />)
  }

  it('centers the whole graph in the viewport on entry', () => {
    renderCanvas()
    const stage = stageView()
    expect(stage.scale).toBeGreaterThanOrEqual(MIN_SCALE)
    expect(stage.scale).toBeLessThanOrEqual(1)
    expect(stage.x + stage.width * stage.scale / 2).toBeCloseTo(VIEWPORT_WIDTH / 2, 3)
    expect(stage.y + stage.height * stage.scale / 2).toBeCloseTo(VIEWPORT_HEIGHT / 2, 3)
    expect(stage.width * stage.scale).toBeLessThanOrEqual(VIEWPORT_WIDTH)
    expect(stage.height * stage.scale).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
  })

  it('zooms in and out from the controls and stops at both limits', () => {
    renderCanvas()
    const start = readout()

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(readout()).toBeGreaterThan(start)

    for (let step = 0; step < 20; step += 1) fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(stageView().scale).toBeCloseTo(MAX_SCALE, 6)
    expect(screen.getByRole('button', { name: '放大' })).toHaveProperty('disabled', true)

    for (let step = 0; step < 40; step += 1) fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(stageView().scale).toBeCloseTo(MIN_SCALE, 6)
    expect(screen.getByRole('button', { name: '缩小' })).toHaveProperty('disabled', true)
    expect(readout()).toBe(Math.round(MIN_SCALE * 100))
  })

  it('zooms on the wheel while keeping the point under the cursor anchored', () => {
    renderCanvas()
    const before = stageView()
    const anchorX = 120
    const anchorY = 90
    const stagePointX = (anchorX - before.x) / before.scale
    const stagePointY = (anchorY - before.y) / before.scale

    fireEvent.wheel(viewport(), { deltaY: -240, clientX: anchorX, clientY: anchorY })

    const after = stageView()
    expect(after.scale).toBeGreaterThan(before.scale)
    expect(after.scale).toBeLessThanOrEqual(MAX_SCALE)
    expect(stagePointX * after.scale + after.x).toBeCloseTo(anchorX, 3)
    expect(stagePointY * after.scale + after.y).toBeCloseTo(anchorY, 3)
  })

  it('pans with a background drag and recenters from the fit control', () => {
    renderCanvas()
    const before = stageView()

    fireEvent.pointerDown(viewport(), { pointerId: 1, button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(viewport(), { pointerId: 1, clientX: 260, clientY: 170 })
    fireEvent.pointerUp(viewport(), { pointerId: 1 })

    const panned = stageView()
    expect(panned.x).toBeCloseTo(before.x + 60, 3)
    expect(panned.y).toBeCloseTo(before.y - 30, 3)
    expect(panned.scale).toBe(before.scale)

    fireEvent.click(screen.getByRole('button', { name: '居中并适应窗口' }))
    expect(stageView()).toEqual(before)
  })

  it('leaves node clicks alone when a drag starts on a node', () => {
    const preview = vi.fn()
    render(<GraphCanvas state={state} previewNodeId={null} onPreview={preview} />)
    const before = stageView()
    const target = screen.getByRole('button', { name: '查看 PA1 context' })

    fireEvent.pointerDown(target, { pointerId: 2, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(viewport(), { pointerId: 2, clientX: 160, clientY: 100 })
    fireEvent.pointerUp(viewport(), { pointerId: 2 })
    fireEvent.click(target)

    expect(stageView()).toEqual(before)
    expect(preview).toHaveBeenCalledWith(one.id)
  })
})

describe('project Conversation Graph canvas', () => {
  const response: ProjectGraphResponse = {
    workspaceId: 'w',
    sessions: [{
      sessionId: 's', createdAt: 1, seedLength: 0,
      turns: [
        { turn: 1, prompt: 'First prompt', answer: 'First answer', startedAt: 10, completedAt: 20, boundarySeq: 3, inherited: false, fingerprint: 'one' },
        { turn: 2, prompt: 'Second prompt', answer: 'Second answer', startedAt: 30, completedAt: 40, boundarySeq: 7, inherited: false, fingerprint: 'two' },
      ],
    }],
  }

  it('opens centered and zoomable instead of scrolled to the top-left', async () => {
    render(<ProjectGraphPage
      workspaceId="w" workspaceTitle="Project" sessionTitles={{ s: 'Session one' }}
      load={async () => response} getLocalState={() => graph([])}
      onClose={vi.fn()} onOpenSession={vi.fn()}
    />)
    await screen.findByRole('button', { name: '查看 PA2 context' })

    const stage = stageView()
    expect(stage.x + stage.width * stage.scale / 2).toBeCloseTo(VIEWPORT_WIDTH / 2, 3)
    expect(stage.y + stage.height * stage.scale / 2).toBeCloseTo(VIEWPORT_HEIGHT / 2, 3)
    expect(screen.getByRole('button', { name: '放大' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '缩小' })).toBeTruthy()
  })
})
