import { describe, expect, it } from 'vitest'
import { nodeHash, nodeLabelMap } from '../src/client/labels.ts'
import { graph, node } from './fixtures.ts'

describe('nodeLabelMap', () => {
  it('retains durable anchor labels and parallel Session labels', () => {
    const source = node({ id: 'source', displayLabel: 'PA7' })
    const child = node({
      id: 'child', sessionId: 'dsh-git-anchor-child', turn: 3,
      displayLabel: 'S1.1', primaryParentId: 'source', parentIds: ['source'],
    })
    const labels = nodeLabelMap(graph([source, child]))
    expect(labels.get('source')).toBe('PA7')
    expect(labels.get('child')).toBe('S1.1')
  })
})

describe('nodeHash', () => {
  it('shortens Session PA ids to the trailing hash', () => {
    expect(nodeHash('pa-33333ca11d')).toBe('PA-ca11d')
  })

  it('summarises project node ids instead of printing the whole session id', () => {
    expect(nodeHash('project-pa:session-d054d1f5-1187-4b29-84b0-b2b6f6a13c77:3'))
      .toBe('PA-13c77:3')
    expect(nodeHash('project-fork:session-d054d1f5-1187-4b29-84b0-b2b6f6a13c77:2'))
      .toBe('FORK-13c77:2')
  })

  it('decodes escaped session segments before summarising', () => {
    expect(nodeHash(`project-pa:${encodeURIComponent('sess ion/ab cde')}:1`)).toBe('PA-b cde:1')
    expect(nodeHash('project-pa:%zz-abcde:1')).toBe('PA-abcde:1')
  })

  it('keeps short unknown ids intact and elides long ones', () => {
    expect(nodeHash('local-node-1')).toBe('local-node-1')
    expect(nodeHash('unknown-node-with-a-very-long-id')).toBe('unknow…ng-id')
  })
})
