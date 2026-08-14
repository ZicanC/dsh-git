import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { buildMergedSessionSeed } from '../src/history.ts'
import {
  decodeCreateMergedSessionPayload,
  encodeCreateMergedSessionPayload,
} from '../src/protocol.ts'

function completedTurn(sessionId: string, question: string, answer: string): Session {
  const session = Session.create(SessionId(sessionId))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: question }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: answer }],
      source: { provider: 'mock', model: 'mock' },
    }),
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

describe('Host-side merged history', () => {
  it('materializes PA1 and PA7 as Turns 1 and 2 so the next request is Turn 3', async () => {
    const pa1 = completedTurn('source-pa1', 'P1', 'A1')
    const pa7 = completedTurn('source-pa7', 'P7', 'A7')
    const sessions = new Map([[pa1.id, pa1], [pa7.id, pa7]])
    const seed = await buildMergedSessionSeed('merged-pa9', [
      { sourceSessionId: pa1.id, sourceTurn: 1, sourceBoundarySeq: turnEndSeq(pa1.events) },
      { sourceSessionId: pa7.id, sourceTurn: 1, sourceBoundarySeq: turnEndSeq(pa7.events) },
    ], async sessionId => {
      const session = sessions.get(sessionId)
      if (session === undefined) throw new Error('missing fixture session')
      return { session: session.header, events: [...session.events] }
    })

    expect(seed.filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2])
    expect(seed.filter(event => event.type === 'turn/end').map(event => event.data.turn)).toEqual([1, 2])
    const merged = Session.create(SessionId('merged-pa9'), seed)
    merged.append('turn/start', { turn: 3 })
    expect(merged.events.filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2, 3])
    expect(merged.deriveMessages().map(message => JSON.stringify(message.content))).toEqual([
      JSON.stringify([{ type: 'text', text: 'P1' }]),
      JSON.stringify([{ type: 'text', text: 'A1' }]),
      JSON.stringify([{ type: 'text', text: 'P7' }]),
      JSON.stringify([{ type: 'text', text: 'A7' }]),
    ])
  })

  it('round-trips the private command payload without conversation text', () => {
    const payload = {
      targetSessionId: 'merged',
      sources: [{ sourceSessionId: 'source', sourceTurn: 7, sourceBoundarySeq: 42 }],
    }
    const encoded = encodeCreateMergedSessionPayload(payload)
    expect(encoded).not.toContain('prompt')
    expect(decodeCreateMergedSessionPayload(encoded)).toEqual(payload)
  })
})
