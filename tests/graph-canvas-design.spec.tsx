// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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

function graphNode(nodeId: string): HTMLButtonElement {
  return document.querySelector(`[data-node-id="${nodeId}"]`) as HTMLButtonElement
}

describe('GraphCanvas final visual design', () => {
  const root = node({ id: 'pa-design-root', createdAt: 1 })
  const continuation = node({
    id: 'pa-design-continuation', createdAt: 2,
    primaryParentId: root.id, parentIds: [root.id],
  })
  const sibling = node({
    id: 'pa-design-sibling', createdAt: 3,
    primaryParentId: root.id, parentIds: [root.id],
  })
  const fork = node({
    id: 'pa-design-fork', sessionId: 'session-b', branchId: 'branch-b', createdAt: 4,
    primaryParentId: null, parentIds: [], forkSourceId: root.id,
    prompt: root.prompt, answer: root.answer,
  })
  const forkChild = node({
    id: 'pa-design-fork-child', sessionId: 'session-b', branchId: 'branch-b', createdAt: 5,
    primaryParentId: fork.id, parentIds: [fork.id],
  })
  const merge = node({
    id: 'pa-design-merge', sessionId: 'session-c', branchId: 'branch-c', createdAt: 6,
    primaryParentId: forkChild.id, parentIds: [root.id, forkChild.id],
    contextManifest: [root.id, forkChild.id],
  })
  const state = graph([root, continuation, sibling, fork, forkChild, merge], {
    headNodeId: merge.id,
    previewNodeId: null,
    contextManifest: [],
  })

  it('uses lineage rows, adjacent fork identity, and a new right-side merge lane', () => {
    render(<GraphCanvas state={state} previewNodeId={null} onPreview={vi.fn()} />)

    expect(graphNode(root.id).dataset.layoutRow).toBe('0')
    expect(graphNode(fork.id).dataset.layoutRow).toBe('0')
    expect(graphNode(continuation.id).dataset.layoutRow).toBe('1')
    expect(graphNode(sibling.id).dataset.layoutRow).toBe('1')
    expect(graphNode(forkChild.id).dataset.layoutRow).toBe('1')
    expect(graphNode(merge.id).dataset.layoutRow).toBe('2')
    expect(graphNode(sibling.id).dataset.layoutLane).toBe('1')
    expect(graphNode(forkChild.id).dataset.layoutLane).toBe('2')

    expect(Number.parseFloat(graphNode(fork.id).style.left)
      - Number.parseFloat(graphNode(root.id).style.left)).toBe(156)
    expect(Number.parseFloat(graphNode(continuation.id).style.top)
      - Number.parseFloat(graphNode(root.id).style.top)).toBe(100)
    expect(Number.parseFloat(graphNode(merge.id).style.left))
      .toBeGreaterThan(Number.parseFloat(graphNode(forkChild.id).style.left))

    expect(graphNode(fork.id).textContent).toBe('PA1FORK')
    expect(graphNode(merge.id).textContent).toContain('MERGE·2')
    expect(document.querySelectorAll('[data-fork-source-id="pa-design-root"]')).toHaveLength(1)
  })

  it('opens only the occupied row suffix when a late fork needs the adjacent slot', () => {
    const pa2 = node({
      id: 'pa-row-pa2', createdAt: 2,
      primaryParentId: root.id, parentIds: [root.id],
    })
    const pa3 = node({
      id: 'pa-row-pa3', createdAt: 3,
      primaryParentId: pa2.id, parentIds: [pa2.id],
    })
    const pa3Fork = node({
      id: 'pa-row-pa3-fork', createdAt: 4, forkSourceId: pa3.id,
      primaryParentId: null, parentIds: [],
    })
    const pa4 = node({
      id: 'pa-row-pa4', createdAt: 5,
      primaryParentId: pa3.id, parentIds: [pa3.id],
    })
    const pa5 = node({
      id: 'pa-row-pa5', createdAt: 6,
      primaryParentId: pa3Fork.id, parentIds: [pa3Fork.id],
    })
    const pa6 = node({
      id: 'pa-row-pa6', createdAt: 7,
      primaryParentId: pa5.id, parentIds: [pa5.id],
    })
    const pa4Fork = node({
      id: 'pa-row-pa4-fork', createdAt: 8, forkSourceId: pa4.id,
      primaryParentId: null, parentIds: [],
    })
    const collisionState = graph([root, pa2, pa3, pa3Fork, pa4, pa5, pa6, pa4Fork])

    render(<GraphCanvas state={collisionState} previewNodeId={null} onPreview={vi.fn()} />)

    expect(graphNode(pa3.id).dataset.layoutLane).toBe('0')
    expect(graphNode(pa3Fork.id).dataset.layoutLane).toBe('1')
    expect(graphNode(pa4.id).dataset.layoutLane).toBe('0')
    expect(graphNode(pa4Fork.id).dataset.layoutLane).toBe('1')
    expect(graphNode(pa5.id).dataset.layoutLane).toBe('2')
    expect(graphNode(pa6.id).dataset.layoutLane).toBe('1')
    expect(Number.parseFloat(graphNode(pa3Fork.id).style.left)
      - Number.parseFloat(graphNode(pa3.id).style.left)).toBe(156)
  })

  it('does not move a row suffix when the fork-adjacent slot is already empty', () => {
    const middleRoot = node({ id: 'pa-empty-slot-middle-root', createdAt: 2 })
    const rightRoot = node({ id: 'pa-empty-slot-right-root', createdAt: 3 })
    const source = node({
      id: 'pa-empty-slot-source', createdAt: 4,
      primaryParentId: root.id, parentIds: [root.id],
    })
    const rightContinuation = node({
      id: 'pa-empty-slot-right-continuation', createdAt: 5,
      primaryParentId: rightRoot.id, parentIds: [rightRoot.id],
    })
    const sourceFork = node({
      id: 'pa-empty-slot-source-fork', createdAt: 6,
      primaryParentId: null, parentIds: [], forkSourceId: source.id,
    })
    const emptySlotState = graph([
      root, middleRoot, rightRoot, source, rightContinuation, sourceFork,
    ])

    render(<GraphCanvas state={emptySlotState} previewNodeId={null} onPreview={vi.fn()} />)

    expect(graphNode(source.id).dataset.layoutLane).toBe('0')
    expect(graphNode(sourceFork.id).dataset.layoutLane).toBe('1')
    expect(graphNode(rightContinuation.id).dataset.layoutLane).toBe('2')
  })

  it('keeps later rows fixed when a late fork moves the source-row suffix', () => {
    const otherRoot = node({ id: 'pa-local-fork-other-root', createdAt: 2 })
    const existingMerge = node({
      id: 'pa-local-fork-merge', createdAt: 3,
      primaryParentId: otherRoot.id, parentIds: [root.id, otherRoot.id],
    })
    const lateFork = node({
      id: 'pa-local-fork-copy', createdAt: 4,
      primaryParentId: null, parentIds: [], forkSourceId: root.id,
    })
    const lateForkState = graph([root, otherRoot, existingMerge, lateFork])

    render(<GraphCanvas state={lateForkState} previewNodeId={null} onPreview={vi.fn()} />)

    expect(graphNode(lateFork.id).dataset.layoutLane).toBe('1')
    expect(graphNode(otherRoot.id).dataset.layoutLane).toBe('2')
    // The merge was already placed on another row. The fork insertion reroutes
    // its edge from the shifted parent; it does not trigger a global reflow.
    expect(graphNode(existingMerge.id).dataset.layoutLane).toBe('2')
    expect(document.querySelector<SVGPathElement>(
      `[data-parent-id="${otherRoot.id}"][data-child-id="${existingMerge.id}"]`,
    )?.getAttribute('d')).toBe('M 410 74 V 103 H 410 V 132')
  })

  it('chains multiple fork copies with adjacent arrows instead of crossing a copy', () => {
    const firstFork = node({
      id: 'pa-chain-fork-one', createdAt: 2, forkSourceId: root.id,
      primaryParentId: null, parentIds: [],
    })
    const secondFork = node({
      id: 'pa-chain-fork-two', createdAt: 3, forkSourceId: root.id,
      primaryParentId: null, parentIds: [],
    })
    const chainState = graph([root, firstFork, secondFork])

    render(<GraphCanvas state={chainState} previewNodeId={null} onPreview={vi.fn()} />)

    const arrows = [...document.querySelectorAll(`[data-fork-source-id="${root.id}"]`)]
    expect(arrows).toHaveLength(2)
    expect(arrows[0]?.getAttribute('data-fork-from-id')).toBe(root.id)
    expect(arrows[0]?.getAttribute('data-fork-copy-id')).toBe(firstFork.id)
    expect(arrows[1]?.getAttribute('data-fork-from-id')).toBe(firstFork.id)
    expect(arrows[1]?.getAttribute('data-fork-copy-id')).toBe(secondFork.id)
  })

  it('does not let an earlier merge consume the ordinary first-child column', () => {
    const otherRoot = node({ id: 'pa-merge-other-root', createdAt: 2 })
    const earlyMerge = node({
      id: 'pa-merge-early', createdAt: 3,
      primaryParentId: otherRoot.id, parentIds: [root.id, otherRoot.id],
    })
    const laterOrdinaryChild = node({
      id: 'pa-merge-later-child', createdAt: 4,
      primaryParentId: root.id, parentIds: [root.id],
    })
    const mergeFirstState = graph([root, otherRoot, earlyMerge, laterOrdinaryChild])

    render(<GraphCanvas state={mergeFirstState} previewNodeId={null} onPreview={vi.fn()} />)

    expect(graphNode(laterOrdinaryChild.id).style.left).toBe(graphNode(root.id).style.left)
    expect(Number.parseFloat(graphNode(earlyMerge.id).style.left))
      .toBeGreaterThan(Number.parseFloat(graphNode(otherRoot.id).style.left))
  })

  it('does not carry sparse lanes from earlier rows into later branches and merges', () => {
    const compactRoot = node({ id: 'pa-compact-root', createdAt: 1 })
    const otherRoot = node({ id: 'pa-compact-other-root', createdAt: 2 })
    const mainOne = node({
      id: 'pa-compact-main-one', createdAt: 3,
      primaryParentId: compactRoot.id, parentIds: [compactRoot.id],
    })
    const sideOne = node({
      id: 'pa-compact-side-one', createdAt: 4,
      primaryParentId: compactRoot.id, parentIds: [compactRoot.id],
    })
    const mainTwo = node({
      id: 'pa-compact-main-two', createdAt: 5,
      primaryParentId: mainOne.id, parentIds: [mainOne.id],
    })
    const sideTwo = node({
      id: 'pa-compact-side-two', createdAt: 6,
      primaryParentId: mainOne.id, parentIds: [mainOne.id],
    })
    const mainThree = node({
      id: 'pa-compact-main-three', createdAt: 7,
      primaryParentId: mainTwo.id, parentIds: [mainTwo.id],
    })
    const sideThree = node({
      id: 'pa-compact-side-three', createdAt: 8,
      primaryParentId: mainTwo.id, parentIds: [mainTwo.id],
    })
    const firstMerge = node({
      id: 'pa-compact-merge-one', createdAt: 9,
      primaryParentId: otherRoot.id, parentIds: [mainThree.id, otherRoot.id],
    })
    const secondMerge = node({
      id: 'pa-compact-merge-two', createdAt: 10,
      primaryParentId: firstMerge.id, parentIds: [mainThree.id, firstMerge.id],
    })
    const compactState = graph([
      compactRoot, otherRoot,
      mainOne, sideOne, mainTwo, sideTwo, mainThree, sideThree,
      firstMerge, secondMerge,
    ])

    render(<GraphCanvas state={compactState} previewNodeId={null} onPreview={vi.fn()} />)

    expect(graphNode(sideOne.id).dataset.layoutLane).toBe('1')
    expect(graphNode(sideTwo.id).dataset.layoutLane).toBe('1')
    expect(graphNode(sideThree.id).dataset.layoutLane).toBe('1')
    expect(graphNode(firstMerge.id).dataset.layoutLane).toBe('2')
    expect(graphNode(secondMerge.id).dataset.layoutLane).toBe('3')
    expect(document.querySelector<HTMLElement>('.dsh-git-tree-stage')?.style.width).toBe('664px')
  })

  it('draws fixed-elbow black lines and solid purple merge lines into one target spine', () => {
    render(<GraphCanvas state={state} previewNodeId={null} onPreview={vi.fn()} />)

    const ordinary = [...document.querySelectorAll<SVGPathElement>('[data-edge-kind="lineage"]')]
    const merges = [...document.querySelectorAll<SVGPathElement>('[data-edge-kind="merge"]')]
    expect(ordinary).toHaveLength(3)
    expect(merges).toHaveLength(2)
    expect(document.querySelector('[data-child-id="pa-design-fork"]')).toBeNull()

    const siblingEdge = document.querySelector<SVGPathElement>(
      `[data-parent-id="${root.id}"][data-child-id="${sibling.id}"]`,
    )
    expect(siblingEdge?.getAttribute('d')).toBe('M 98 74 V 103 H 254 V 132')

    const rootMerge = document.querySelector<SVGPathElement>(
      `[data-parent-id="${root.id}"][data-child-id="${merge.id}"]`,
    )
    const forkMerge = document.querySelector<SVGPathElement>(
      `[data-parent-id="${forkChild.id}"][data-child-id="${merge.id}"]`,
    )
    expect(rootMerge?.getAttribute('d')).toBe('M 106 74 V 103 H 566 V 232')
    expect(forkMerge?.getAttribute('d')).toBe('M 410 174 V 203 H 566 V 232')
    expect(STYLES).toContain('.dsh-git-tree-edge-merge{stroke:var(--dsh-git-merge-line);stroke-dasharray:none}')
  })

  it('dims only nodes outside the inspected PA context and mutes unrelated fork arrows', () => {
    const unrelated = node({ id: 'pa-design-unrelated', createdAt: 7 })
    const unrelatedFork = node({
      id: 'pa-design-unrelated-fork', sessionId: 'session-d', branchId: 'branch-d', createdAt: 8,
      primaryParentId: null, parentIds: [], forkSourceId: unrelated.id,
      prompt: unrelated.prompt, answer: unrelated.answer,
    })
    const inspected = node({
      id: 'pa-design-inspected', createdAt: 9,
      primaryParentId: continuation.id, parentIds: [continuation.id],
      contextManifest: [root.id],
    })
    const previewState = graph([
      root, continuation, sibling, fork, forkChild, unrelated, unrelatedFork, inspected,
    ], { contextManifest: [unrelated.id] })

    const view = render(
      <GraphCanvas state={previewState} previewNodeId={inspected.id} onPreview={vi.fn()} />,
    )

    expect(graphNode(inspected.id).classList.contains('dsh-git-tree-node-dim')).toBe(false)
    expect(graphNode(root.id).classList.contains('dsh-git-tree-node-dim')).toBe(false)
    expect(graphNode(fork.id).classList.contains('dsh-git-tree-node-dim')).toBe(false)
    expect(graphNode(continuation.id).classList.contains('dsh-git-tree-node-dim')).toBe(true)
    expect(graphNode(unrelated.id).classList.contains('dsh-git-tree-node-dim')).toBe(true)
    expect(document.querySelector(`[data-fork-copy-id="${fork.id}"]`)
      ?.classList.contains('dsh-git-tree-fork-arrow-muted')).toBe(false)
    expect(document.querySelector(`[data-fork-copy-id="${unrelatedFork.id}"]`)
      ?.classList.contains('dsh-git-tree-fork-arrow-muted')).toBe(true)

    for (const edge of document.querySelectorAll('[data-edge-kind]')) {
      expect(edge.classList.contains('dsh-git-tree-node-dim')).toBe(false)
    }
    expect(STYLES).toContain('.dsh-git-tree-node.dsh-git-tree-node-dim,.dsh-git-tree-node.dsh-git-tree-node-dim:disabled{opacity:.24}')
    expect(STYLES).toContain('--dsh-git-fork-arrow-muted:light-dark(#d6d6dc,#4a4a51)')

    view.rerender(<GraphCanvas state={previewState} previewNodeId={fork.id} onPreview={vi.fn()} />)
    expect(graphNode(root.id).classList.contains('dsh-git-tree-node-dim')).toBe(false)
    expect(graphNode(fork.id).classList.contains('dsh-git-tree-node-dim')).toBe(false)
    expect(graphNode(continuation.id).classList.contains('dsh-git-tree-node-dim')).toBe(true)
  })

  it('keeps the final 132x42 node geometry and relation tag typography', () => {
    render(<GraphCanvas
      state={state}
      previewNodeId={merge.id}
      onPreview={vi.fn()}
      nodeColors={new Map([[merge.id, 4]])}
    />)

    expect(graphNode(merge.id).style.width).toBe('132px')
    expect(graphNode(merge.id).style.height).toBe('42px')
    expect(graphNode(merge.id).style.getPropertyValue('--dsh-git-node-color')).toBe('')
    expect(STYLES).toContain('border-radius:8px;background:light-dark(#fff,#202023)')
    expect(STYLES).toContain('.dsh-git-tree-relation-tag{flex:none;color:light-dark(#8f9099,#8b8b93);font:500 10px/16px')
    expect(STYLES).not.toContain('dsh-git-tree-edge-active')
    expect(STYLES).not.toContain('dsh-git-tree-node-context')
    expect(screen.getByRole('button', { name: '查看 PA5 context' })).toBe(graphNode(merge.id))
    expect(graphNode(root.id).hasAttribute('title')).toBe(false)
    expect(document.querySelector('[title*="question pa-design-root"]')).toBeNull()
  })
})
