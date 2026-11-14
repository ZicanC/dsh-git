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

  it('labels a copy of a fork copy as one fork of the original PA', () => {
    // A Chat forked from a Session whose own tip is a fork copy: the copy it
    // registers points at that copy, not at the original.
    const original = node({ id: 'original', createdAt: 1, ledgerOrdinal: 2, finalOrdinal: 1 })
    const copy = node({
      id: 'copy', sessionId: 'fork', createdAt: 2, ledgerOrdinal: 2, finalOrdinal: 2, forkSourceId: 'original',
    })
    const copyOfCopy = node({
      id: 'copy-of-copy', sessionId: 'dsh-git-child', createdAt: 3, ledgerOrdinal: 2, finalOrdinal: 3,
      forkSourceId: 'copy',
    })
    const labels = nodeLabelMap(graph([original, copy, copyOfCopy]))

    expect(labels.get('original')).toBe('PA2')
    expect(labels.get('copy')).toBe('PA2 fork')
    expect(labels.get('copy-of-copy')).toBe('PA2 fork')
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
