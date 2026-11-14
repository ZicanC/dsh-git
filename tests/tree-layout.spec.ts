import { describe, expect, it } from 'vitest'
import { NODE_HEIGHT, NODE_WIDTH, connector, layoutTree } from '../src/client/tree-layout.ts'
import { graph, node } from './fixtures.ts'

/** Row and lane of every node, by id. */
function cells(state: Parameters<typeof layoutTree>[0]): Record<string, readonly [number, number]> {
  return Object.fromEntries(layoutTree(state).positions.map(position =>
    [position.nodeId, [position.row, position.lane] as const]))
}

describe('conversation tree layout', () => {
  it('stacks one lineage in a single lane, one row per turn', () => {
    const state = graph([
      node({ id: 'a', createdAt: 1 }),
      node({ id: 'b', createdAt: 2, turn: 2, parentIds: ['a'], primaryParentId: 'a' }),
      node({ id: 'c', createdAt: 3, turn: 3, parentIds: ['b'], primaryParentId: 'b' }),
    ])

    expect(cells(state)).toEqual({ a: [0, 0], b: [1, 0], c: [2, 0] })
    const layout = layoutTree(state)
    expect(layout.mergeSpines.size).toBe(0)
    expect(layout.height).toBeGreaterThan(NODE_HEIGHT * 3)
  })

  it('keeps the first child under its parent and opens a lane to the right for the next', () => {
    const state = graph([
      node({ id: 'a', createdAt: 1 }),
      node({ id: 'b', createdAt: 2, turn: 2, parentIds: ['a'], primaryParentId: 'a' }),
      node({ id: 'c', createdAt: 3, turn: 2, sessionId: 'other', parentIds: ['a'], primaryParentId: 'a' }),
    ])

    expect(cells(state)).toEqual({ a: [0, 0], b: [1, 0], c: [1, 1] })
  })

  it('places a fork copy beside its source on the same row, moving what stood there', () => {
    const state = graph([
      node({ id: 'a', createdAt: 1 }),
      node({ id: 'side', createdAt: 2, sessionId: 'side' }),
      node({ id: 'a-fork', createdAt: 3, sessionId: 'fork', forkSourceId: 'a' }),
      node({ id: 'next', createdAt: 4, sessionId: 'fork', turn: 2, parentIds: ['a-fork'], primaryParentId: 'a-fork' }),
    ])

    // `side` was laid out in lane 1 first and gives that slot to the copy.
    expect(cells(state)).toEqual({ 'a': [0, 0], 'a-fork': [0, 1], 'side': [0, 2], 'next': [1, 1] })
  })

  it('opens a fresh lane right of every lineage a merge joins, with a spine in the gutter before it', () => {
    const state = graph([
      node({ id: 'a', createdAt: 1 }),
      node({ id: 'b', createdAt: 2, sessionId: 'other' }),
      node({ id: 'b2', createdAt: 3, sessionId: 'other', turn: 2, parentIds: ['b'], primaryParentId: 'b' }),
      node({ id: 'm', createdAt: 4, sessionId: 'merged', parentIds: ['a', 'b2'], primaryParentId: 'b2' }),
    ])

    expect(cells(state)).toEqual({ a: [0, 0], b: [0, 1], b2: [1, 1], m: [2, 2] })
    const layout = layoutTree(state)
    const merge = layout.positions.find(position => position.nodeId === 'm')!
    const spine = layout.mergeSpines.get('m')!
    expect(spine).toBeLessThan(merge.x - NODE_WIDTH / 2)
    expect(spine).toBeGreaterThan(layout.positions.find(position => position.nodeId === 'b2')!.x + NODE_WIDTH / 2)
  })

  it('draws a straight edge within a lane and a rounded elbow across lanes', () => {
    const state = graph([
      node({ id: 'a', createdAt: 1 }),
      node({ id: 'b', createdAt: 2, turn: 2, parentIds: ['a'], primaryParentId: 'a' }),
      node({ id: 'c', createdAt: 3, turn: 2, sessionId: 'other', parentIds: ['a'], primaryParentId: 'a' }),
    ])
    const byId = new Map(layoutTree(state).positions.map(position => [position.nodeId, position]))

    expect(connector(byId.get('a')!, byId.get('b')!)).toMatch(/^M [\d.]+ [\d.]+ V [\d.]+$/)
    expect(connector(byId.get('a')!, byId.get('c')!)).toContain(' Q ')
  })
})
