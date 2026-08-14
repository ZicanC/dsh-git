import { describe, expect, it } from 'vitest'
import { layoutGraph, missingDirectDependencies, primaryPath } from '../src/client/graph.ts'
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

})
