import { describe, expect, it } from 'vitest'
import {
  joinsLineages, layoutGraph, lineageParentPlan, missingDirectDependencies,
  normalizeContextOccurrences, paIdentityId, primaryPath,
} from '../src/client/graph.ts'
import { graph, node } from './fixtures.ts'

describe('conversation graph', () => {
  const one = node({ id: 'pa1', createdAt: 1 })
  const two = node({ id: 'pa2', createdAt: 2, primaryParentId: 'pa1', parentIds: ['pa1'] })
  const three = node({ id: 'pa3', createdAt: 3, primaryParentId: 'pa1', parentIds: ['pa1'] })
  const merge = node({
    id: 'pa4', createdAt: 4, primaryParentId: 'pa2', parentIds: ['pa2', 'pa3'],
  })
  const state = graph([one, two, three, merge])

  it('highlights the primary line independently of merge parents', () => {
    expect(primaryPath(state, 'pa4')).toEqual(['pa1', 'pa2', 'pa4'])
  })

  it('assigns a new lane to a sibling and marks the extra parent as a merge edge', () => {
    const layout = layoutGraph(state)
    const lanes = Object.fromEntries(layout.positions.map(position => [position.nodeId, position.lane]))
    expect(lanes.pa2).toBe(lanes.pa1)
    expect(lanes.pa3).not.toBe(lanes.pa1)
    expect(layout.edges.find(edge => edge.parentId === 'pa3' && edge.childId === 'pa4')?.merge).toBe(true)
  })

  it('reports skipped direct dependencies without forcing them into the tray', () => {
    expect(missingDirectDependencies(state, ['pa1', 'pa3', 'pa4'])).toEqual(['pa2'])
  })

  it('separates a fork of one Session from a merge across two', () => {
    const foreign = node({ id: 'pa5', sessionId: 'session-b', createdAt: 5 })
    const spread = graph([one, two, three, merge, foreign])
    expect(joinsLineages(spread, [])).toBe(false)
    expect(joinsLineages(spread, ['pa1', 'pa3', 'pa4'])).toBe(false)
    expect(joinsLineages(spread, ['pa1', 'pa5'])).toBe(true)
    // A stale reference cannot invent a second lineage.
    expect(joinsLineages(spread, ['pa1', 'missing'])).toBe(false)
  })

  it('uses each Session terminal in terminal Tray order for lineage parents', () => {
    const a1 = node({ id: 'a1', sessionId: 'a', createdAt: 1 })
    const b1 = node({ id: 'b1', sessionId: 'b', createdAt: 2 })
    const a2 = node({ id: 'a2', sessionId: 'a', createdAt: 3 })
    const c1 = node({ id: 'c1', sessionId: 'c', createdAt: 4 })
    const b2 = node({ id: 'b2', sessionId: 'b', createdAt: 5 })
    const spread = graph([a1, b1, a2, c1, b2])

    expect(lineageParentPlan(spread, ['a1', 'b1', 'a2', 'c1', 'b2'])).toEqual({
      parentIds: ['a2', 'c1', 'b2'],
      primaryParentId: 'b2',
    })
    expect(lineageParentPlan(spread, ['a1', 'a2'])).toEqual({
      parentIds: ['a2'],
      primaryParentId: 'a2',
    })
  })

  it('treats an original PA and its fork copies as one Context identity', () => {
    const original = node({ id: 'original', sessionId: 'source', createdAt: 1 })
    const fork = node({
      id: 'fork', sessionId: 'fork-session', createdAt: 2,
      forkSourceId: original.id, primaryParentId: null, parentIds: [],
    })
    const other = node({ id: 'other', sessionId: 'other-session', createdAt: 3 })
    const spread = graph([original, fork, other])

    expect(paIdentityId(spread, fork.id)).toBe(original.id)
    expect(normalizeContextOccurrences(spread, [original.id, other.id, fork.id]))
      .toEqual([fork.id, other.id])
    expect(lineageParentPlan(spread, [original.id, fork.id])).toEqual({
      parentIds: [fork.id],
      primaryParentId: fork.id,
    })
    expect(joinsLineages(spread, [original.id, fork.id])).toBe(false)
  })

})
