import { describe, expect, it } from 'vitest'
import { HistoryPreviewCache, previewSourceKey } from '../src/client/preview-cache.ts'
import type {
  HistoryPreviewRecord, HistoryPreviewResponse, HistoryTurnSource,
} from '../src/protocol.ts'

function source(turn: number, sessionId = 'session-a'): HistoryTurnSource {
  return { sourceSessionId: sessionId, sourceTurn: turn, sourceBoundarySeq: turn * 10 }
}

function records(text: string): readonly HistoryPreviewRecord[] {
  return [{
    kind: 'user',
    seq: 1,
    messageId: text,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }]
}

function response(...sources: readonly HistoryTurnSource[]): HistoryPreviewResponse {
  return {
    turns: sources.map((entry, index) => ({
      source: entry,
      targetTurn: index + 1,
      records: records(`turn ${entry.sourceTurn}`),
    })),
  }
}

describe('HistoryPreviewCache', () => {
  it('requests only sources it has never read, ignoring order and duplicates', () => {
    const cache = new HistoryPreviewCache()
    expect(cache.missing([source(1), source(2)])).toEqual([source(1), source(2)])

    cache.absorb(response(source(1), source(2)))

    expect(cache.missing([source(2), source(1)])).toEqual([])
    expect(cache.missing([source(3), source(1), source(3)])).toEqual([source(3)])
  })

  it('keeps sources of different Sessions apart', () => {
    const cache = new HistoryPreviewCache()
    cache.absorb(response(source(1, 'session-a')))

    expect(cache.has(source(1, 'session-a'))).toBe(true)
    expect(cache.has(source(1, 'session-b'))).toBe(false)
    expect(previewSourceKey(source(1, 'session-a')))
      .not.toBe(previewSourceKey(source(1, 'session-b')))
  })

  it('assembles the selected order locally, renumbering target turns without a read', () => {
    const cache = new HistoryPreviewCache()
    cache.absorb(response(source(1), source(2)))

    const assembled = cache.assemble([source(2), source(1)])

    expect(assembled.turns.map(turn => [turn.source.sourceTurn, turn.targetTurn]))
      .toEqual([[2, 1], [1, 2]])
    expect(assembled.turns[0]?.records).toBe(cache.get(source(2)))
  })

  it('renders known PAs and leaves an unread PA empty until its records land', () => {
    const cache = new HistoryPreviewCache()
    cache.absorb(response(source(1)))

    const assembled = cache.assemble([source(1), source(2)])

    expect(assembled.turns[0]?.records).toHaveLength(1)
    expect(assembled.turns[1]?.records).toEqual([])
    expect(cache.get(source(2))).toBeNull()
  })

  it('evicts the least recently absorbed turns past the ceiling', () => {
    const cache = new HistoryPreviewCache()
    for (let turn = 1; turn <= 1030; turn += 1) cache.absorb(response(source(turn)))

    expect(cache.has(source(1))).toBe(false)
    expect(cache.has(source(6))).toBe(false)
    expect(cache.has(source(7))).toBe(true)
    expect(cache.has(source(1030))).toBe(true)
  })
})
