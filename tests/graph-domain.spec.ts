import { describe, expect, it } from 'vitest'
import { GRAPH_DOMAIN, MAX_SCOPE_ID_LENGTH, assertScopeId, graphStateSchema } from '../src/graph-domain.ts'
import {
  decodeGraphReadRequest, decodeGraphReadResponse, decodeGraphWriteRequest,
} from '../src/protocol.ts'
import { GraphRepository } from '../src/client/repository.ts'
import { EMPTY_GRAPH_STATE } from '../src/client/types.ts'

const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

describe('graph domain', () => {
  it('names the domain and its tables the way the backend accepts', () => {
    expect(GRAPH_DOMAIN.name).toMatch(UNIT_NAME_RE)
    for (const table of Object.keys(GRAPH_DOMAIN.tables)) expect(table).toMatch(UNIT_NAME_RE)
  })

  it('round-trips a real repository ledger through the stored schema', () => {
    const repository = new GraphRepository()
    repository.syncSession('source', [
      { turn: 1, prompt: 'q1', answer: 'a1', createdAt: 10, boundarySeq: 5 },
      { turn: 2, prompt: 'q2', answer: 'a2', createdAt: 20, boundarySeq: 9 },
    ])
    const before = repository.getSnapshot()
    const one = before.sessionTurnRefs.source![1]!
    const two = before.sessionTurnRefs.source![2]!
    repository.prepareBranch({
      sourceSessionId: 'source',
      childSessionId: 'child',
      baseNodeId: one,
      importedNodeIds: [one, two],
      parentIds: [one, two],
      primaryParentId: two,
      contextManifest: [two, one],
      prompt: 'merged question',
    })

    const state = repository.getSnapshot()
    // The medium stores JSON, so parse what a real write would carry.
    const parsed = graphStateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(parsed).toEqual(state)
  })

  it('accepts the empty ledger a fresh scope starts from', () => {
    expect(graphStateSchema.parse(EMPTY_GRAPH_STATE)).toEqual(EMPTY_GRAPH_STATE)
  })

  it('rejects a ledger whose node lost a required field', () => {
    const broken = {
      ...EMPTY_GRAPH_STATE,
      nodes: { 'pa-1': { id: 'pa-1', sessionId: 's1', turn: 1, prompt: 'q' } },
    }
    expect(() => graphStateSchema.parse(broken)).toThrow()
  })

  it('rejects a ledger written under a future format', () => {
    expect(() => graphStateSchema.parse({ ...EMPTY_GRAPH_STATE, format: 2 })).toThrow()
  })
})

describe('scope ids', () => {
  it('accepts the two shapes the browser addresses ledgers with', () => {
    expect(assertScopeId('workspace:abc')).toBe('workspace:abc')
    expect(assertScopeId('session:dsh-git-1')).toBe('session:dsh-git-1')
  })

  it('rejects a blank or oversized scope id', () => {
    expect(() => assertScopeId('  ')).toThrow(/non-blank/)
    expect(() => assertScopeId(undefined)).toThrow(/non-blank/)
    expect(() => assertScopeId('w'.repeat(MAX_SCOPE_ID_LENGTH + 1))).toThrow(/exceeds/)
  })
})

describe('ledger wire decoders', () => {
  it('reads a scope and tolerates a scope that has never been written', () => {
    expect(decodeGraphReadRequest({ scopeId: 'workspace:one' })).toEqual({ scopeId: 'workspace:one' })
    expect(decodeGraphReadResponse({ scopeId: 'workspace:one', state: null }).state).toBeNull()
  })

  it('refuses a read response whose state is not an object', () => {
    expect(() => decodeGraphReadResponse({ scopeId: 'workspace:one', state: 'nope' }))
      .toThrow(/must be an object or null/)
  })

  it('refuses a write with a missing scope or a non-object state', () => {
    expect(() => decodeGraphWriteRequest({ state: EMPTY_GRAPH_STATE })).toThrow(/scopeId/)
    expect(() => decodeGraphWriteRequest({ scopeId: 'workspace:one', state: [] })).toThrow(/must be an object/)
  })
})
