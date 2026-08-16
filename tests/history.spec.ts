import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { buildMergedSessionSeed } from '../src/history.ts'
import { MERGE_LINEAGE_EVENT, readMergeLineage } from '../src/merge-lineage.ts'
import { projectSession } from '../src/project-history.ts'
import {
  decodeCreateMergedSessionRequest,
  decodeCreateMergedSessionResponse,
  decodeProjectGraphResponse,
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

  it('closes the seed with an ignorable lineage event that carries Host coordinates', async () => {
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

    const lineage = seed.at(-1)!
    expect(lineage.type).toBe(MERGE_LINEAGE_EVENT)
    // Without this flag session-persistence refuses to load the whole session.
    expect(lineage.ignorable).toBe(true)
    expect(lineage.seq).toBe(seed.length - 1)
    expect(seed.map(event => event.seq)).toEqual(seed.map((_, index) => index))
    expect(readMergeLineage(seed)).toEqual({
      sources: [
        { sourceSessionId: 'source-pa1', sourceTurn: 1, sourceBoundarySeq: 5, targetTurn: 1 },
        { sourceSessionId: 'source-pa7', sourceTurn: 1, sourceBoundarySeq: 5, targetTurn: 2 },
      ],
    })
  })

  it('recovers merge lineage through the project graph wire without any browser state', async () => {
    const pa1 = completedTurn('source-pa1', 'P1', 'A1')
    const seed = await buildMergedSessionSeed('merged-pa9', [
      { sourceSessionId: pa1.id, sourceTurn: 1, sourceBoundarySeq: turnEndSeq(pa1.events) },
    ], async () => ({ session: pa1.header, events: [...pa1.events] }))
    const merged = Session.create(SessionId('merged-pa9'), seed)

    const dto = projectSession({ session: merged.header, events: [...merged.events] })
    expect(dto.mergeSources).toEqual([
      { sourceSessionId: 'source-pa1', sourceTurn: 1, sourceBoundarySeq: 5, targetTurn: 1 },
    ])
    const decoded = decodeProjectGraphResponse(JSON.parse(JSON.stringify({
      workspaceId: 'w1',
      sessions: [dto],
    })))
    expect(decoded.sessions[0]!.mergeSources).toEqual(dto.mergeSources)
  })

  it('leaves an ordinary session without merge lineage', () => {
    const plain = completedTurn('plain', 'P', 'A')
    const dto = projectSession({ session: plain.header, events: [...plain.events] })
    expect(dto.mergeSources).toBeUndefined()
    expect(readMergeLineage(plain.events)).toBeUndefined()
  })

  it('strictly validates the private merge RPC request and response', () => {
    const request = {
      targetSessionId: 'merged',
      sources: [{ sourceSessionId: 'source', sourceTurn: 7, sourceBoundarySeq: 42 }],
    }
    expect(decodeCreateMergedSessionRequest(request)).toEqual(request)
    expect(decodeCreateMergedSessionResponse({ targetSessionId: 'merged' }))
      .toEqual({ targetSessionId: 'merged' })
    expect(() => decodeCreateMergedSessionRequest({ ...request, rawPrompt: 'must not cross the seam' }))
      .toThrow(/unexpected field/)
    expect(() => decodeCreateMergedSessionRequest({
      ...request,
      sources: [{ ...request.sources[0], extra: true }],
    })).toThrow(/unexpected field/)
    expect(() => decodeCreateMergedSessionResponse({ targetSessionId: 'merged', matched: true }))
      .toThrow(/unexpected field/)
  })
})
