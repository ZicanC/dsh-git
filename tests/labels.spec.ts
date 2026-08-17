import { describe, expect, it } from 'vitest'
import { nodeHash } from '../src/client/labels.ts'

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
