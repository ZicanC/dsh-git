import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { projectHistoryPreview } from '../src/history-preview.ts'
import {
  MAX_MERGED_HISTORY_TURNS,
  decodeHistoryPreviewRequest,
  decodeHistoryPreviewResponse,
} from '../src/protocol.ts'

function richCompletedTurn(sessionId: string): Session {
  const session = Session.create(SessionId(sessionId))
  const image = {
    attachmentId: 'image-1' as never,
    mediaType: 'image/png' as const,
    bytes: 12,
    width: 4,
    height: 3,
    name: 'diagram.png',
  }
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'inspect this' }, { type: 'image', attachment: image }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'mock', model: 'mock' }, system: 'system prompt' },
    reason: 'initial',
  })
  session.append('request/context', {
    provider: 'mock', model: 'mock', contextWindow: 128_000,
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [
        { type: 'reasoning', text: 'check the file' },
        { type: 'text', text: 'running a tool' },
        { type: 'image', attachment: image },
        { type: 'tool-call', id: CallId('call-1'), name: 'read', arguments: '{"path":"a.ts"}' },
        { type: 'future-card', title: 'forward compatible' } as never,
      ],
      source: { provider: 'mock', model: 'mock' },
    }),
    usage: { inputTokens: 10, outputTokens: 5 },
  }, { surfaceOp: 'append' })
  session.append('tool/call', {
    turn: 1, step: 1, callId: CallId('call-1'), name: 'read', arguments: '{"path":"a.ts"}',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId('call-1'),
      content: [{ type: 'text', text: 'file body' }],
      isError: false,
    }),
    meta: { presentation: 'plain' },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

function turnEndSeq(events: readonly SessionEvent[]): number {
  const event = events.findLast(candidate => candidate.type === 'turn/end')
  if (event === undefined) throw new Error('fixture has no turn/end')
  return event.seq
}

describe('Host history preview', () => {
  it('projects full visible records in merged tray order through the real seed builder', async () => {
    const first = richCompletedTurn('first')
    const second = richCompletedTurn('second')
    const sessions = new Map([[first.id, first], [second.id, second]])
    const sources = [second, first].map(session => ({
      sourceSessionId: session.id,
      sourceTurn: 1,
      sourceBoundarySeq: turnEndSeq(session.events),
    }))
    const preview = await projectHistoryPreview(sources, async sessionId => {
      const session = sessions.get(sessionId)
      if (session === undefined) throw new Error('missing fixture session')
      return { session: session.header, events: [...session.events] }
    })

    expect(preview.turns.map(turn => [turn.source.sourceSessionId, turn.targetTurn])).toEqual([
      ['second', 1], ['first', 2],
    ])
    for (const turn of preview.turns) {
      expect(turn.records.map(record => record.kind)).toEqual([
        'user', 'request', 'request', 'assistant', 'tool-call', 'tool-result',
      ])
      const user = turn.records.find(record => record.kind === 'user')
      expect(user?.content).toContainEqual(expect.objectContaining({ type: 'image', attachment: expect.objectContaining({
        attachmentId: 'image-1', mediaType: 'image/png', width: 4, height: 3,
      }) }))
      const assistant = turn.records.find(record => record.kind === 'assistant')
      expect(assistant?.blocks.map(block => block.type)).toEqual([
        'reasoning', 'text', 'image', 'tool-call', 'other',
      ])
      expect(assistant?.blocks.at(-1)).toEqual({
        type: 'other', originalType: 'future-card', value: { type: 'future-card', title: 'forward compatible' },
      })
      expect(assistant?.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
      const result = turn.records.find(record => record.kind === 'tool-result')
      expect(result).toMatchObject({ callId: 'call-1', content: [{ type: 'text', text: 'file body' }] })
    }
    expect(decodeHistoryPreviewResponse(JSON.parse(JSON.stringify(preview)))).toEqual(preview)
  })

  it('uses the merge builder boundary validation instead of accepting a nearby turn', async () => {
    const source = richCompletedTurn('source')
    await expect(projectHistoryPreview([{
      sourceSessionId: source.id,
      sourceTurn: 2,
      sourceBoundarySeq: turnEndSeq(source.events),
    }], async () => ({ session: source.header, events: [...source.events] })))
      .rejects.toThrow(/is not turn 2's end/)
  })

  it('strictly validates source cardinality and every response branch', () => {
    expect(() => decodeHistoryPreviewRequest({ sources: [] }))
      .toThrow(new RegExp(`1 to ${MAX_MERGED_HISTORY_TURNS}`))
    expect(decodeHistoryPreviewRequest({ sources: Array.from({ length: MAX_MERGED_HISTORY_TURNS }, () => ({
      sourceSessionId: 's', sourceTurn: 1, sourceBoundarySeq: 1,
    })) }).sources).toHaveLength(MAX_MERGED_HISTORY_TURNS)
    expect(() => decodeHistoryPreviewRequest({ sources: Array.from({ length: MAX_MERGED_HISTORY_TURNS + 1 }, () => ({
      sourceSessionId: 's', sourceTurn: 1, sourceBoundarySeq: 1,
    })) })).toThrow(new RegExp(`1 to ${MAX_MERGED_HISTORY_TURNS}`))
    expect(() => decodeHistoryPreviewRequest({
      sources: [{ sourceSessionId: 's', sourceTurn: 0, sourceBoundarySeq: 1 }],
    })).toThrow(/sourceTurn/)
    expect(() => decodeHistoryPreviewResponse({
      turns: [{
        source: { sourceSessionId: 's', sourceTurn: 1, sourceBoundarySeq: 2 },
        targetTurn: 1,
        records: [{ kind: 'event', seq: 1, eventType: 'future/event', data: { invalid: undefined } }],
      }],
    })).toThrow(/JSON-serializable/)
  })
})
