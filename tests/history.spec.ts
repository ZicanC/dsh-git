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

/** Append one more completed turn to a fixture Session. */
function appendTurn(session: Session, turn: number, question: string, answer: string): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: question }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: answer }],
      source: { provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function turnEndSeq(events: readonly SessionEvent[]): number {
  const event = events.findLast(candidate => candidate.type === 'turn/end')
  if (event === undefined) throw new Error('fixture has no turn/end')
  return event.seq
}

describe('Host-side merged history', () => {
  it('validates shared-history selection paths and rejects selecting the same PA through two Sessions', async () => {
    const original = completedTurn('original', 'P1', 'A1')
    const events = [...original.snapshotEvents()]
    const source = { sourceSessionId: 'original', sourceTurn: 1, sourceBoundarySeq: turnEndSeq(events) }
    const snapshots = new Map([
      ['original', { session: original.header, inheritedEventCount: 0, events }],
      ['fork', { session: { ...original.header, id: SessionId('fork'), parentSession: original.id }, inheritedEventCount: events.length, events }],
      ['empty', { session: { ...original.header, id: SessionId('empty') }, inheritedEventCount: 0, events: [] }],
    ])
    const read = async (id: string) => snapshots.get(id)!
    const seed = await buildMergedSessionSeed('child', [{ ...source, viaSessionId: 'fork' }], read)
    const lineage = readMergeLineage(seed)!
    expect(lineage.sources[0]!.viaSessionId).toBe('fork')
    const decoded = decodeProjectGraphResponse({ workspaceId: 'w', sessions: [{
      sessionId: 'child', createdAt: 1, seedLength: seed.length, turns: [], mergeSources: lineage.sources,
    }] })
    expect(decoded.sessions[0]!.mergeSources![0]!.viaSessionId).toBe('fork')
    await expect(buildMergedSessionSeed('invalid', [{ ...source, viaSessionId: 'empty' }], read)).rejects.toThrow(/history member/)
    await expect(buildMergedSessionSeed('duplicate', [source, { ...source, sourceSessionId: 'fork' }], read)).rejects.toThrow(/Duplicate/)
  })

  it('addresses a composed Fork copy by the child Session\'s own boundary, not the source\'s', async () => {
    const source = completedTurn('source', 'P1', 'A1')
    appendTurn(source, 2, 'P2', 'A2')
    const sourceEvents = [...source.snapshotEvents()]
    const sourceBoundary = turnEndSeq(sourceEvents)
    const snapshots = new Map<string, { session: Session['header'], inheritedEventCount: number, events: SessionEvent[] }>([
      ['source', { session: source.header, inheritedEventCount: 0, events: sourceEvents }],
    ])
    const read = async (id: string) => {
      const snapshot = snapshots.get(id)
      if (snapshot === undefined) throw new Error('missing fixture session')
      return snapshot
    }
    // A Fork that keeps only the source's second turn renumbers it to Turn 1.
    const seed = [...await buildMergedSessionSeed('child', [
      { sourceSessionId: 'source', sourceTurn: 2, sourceBoundarySeq: sourceBoundary },
    ], read)]
    const childBoundary = turnEndSeq(seed)
    expect(childBoundary).not.toBe(sourceBoundary)
    snapshots.set('child', {
      session: { ...source.header, id: SessionId('child'), parentSession: source.id },
      inheritedEventCount: seed.length,
      events: seed,
    })

    const again = await buildMergedSessionSeed('grandchild', [
      { sourceSessionId: 'child', sourceTurn: 1, sourceBoundarySeq: childBoundary },
    ], read)
    expect(again.filter(event => event.type === 'turn/end').map(event => event.data.turn)).toEqual([1])
    // The coordinates the browser sent before the fix: the child's Session and
    // turn paired with the boundary the turn had in its source Session.
    await expect(buildMergedSessionSeed('stale', [
      { sourceSessionId: 'child', sourceTurn: 1, sourceBoundarySeq: sourceBoundary },
    ], read)).rejects.toThrow(/is not turn 1's end/)
  })

  it('materializes PA1 and PA7 as Turns 1 and 2 so the next request is Turn 3', async () => {
    const pa1 = completedTurn('source-pa1', 'P1', 'A1')
    const pa7 = completedTurn('source-pa7', 'P7', 'A7')
    const sessions = new Map([[pa1.id, pa1], [pa7.id, pa7]])
    const seed = await buildMergedSessionSeed('merged-pa9', [
      { sourceSessionId: pa1.id, sourceTurn: 1, sourceBoundarySeq: turnEndSeq(pa1.snapshotEvents()) },
      { sourceSessionId: pa7.id, sourceTurn: 1, sourceBoundarySeq: turnEndSeq(pa7.snapshotEvents()) },
    ], async sessionId => {
      const session = sessions.get(sessionId)
      if (session === undefined) throw new Error('missing fixture session')
      return { session: session.header, inheritedEventCount: session.inheritedEventCount, events: [...session.snapshotEvents()] }
    })

    expect(seed.filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2])
    expect(seed.filter(event => event.type === 'turn/end').map(event => event.data.turn)).toEqual([1, 2])
    const merged = Session.create(SessionId('merged-pa9'), seed)
    merged.append('turn/start', { turn: 3 })
    expect(merged.snapshotEvents().filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2, 3])
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
      { sourceSessionId: pa1.id, sourceTurn: 1, sourceBoundarySeq: turnEndSeq(pa1.snapshotEvents()) },
      { sourceSessionId: pa7.id, sourceTurn: 1, sourceBoundarySeq: turnEndSeq(pa7.snapshotEvents()) },
    ], async sessionId => {
      const session = sessions.get(sessionId)
      if (session === undefined) throw new Error('missing fixture session')
      return { session: session.header, inheritedEventCount: session.inheritedEventCount, events: [...session.snapshotEvents()] }
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
      { sourceSessionId: pa1.id, sourceTurn: 1, sourceBoundarySeq: turnEndSeq(pa1.snapshotEvents()) },
    ], async () => ({ session: pa1.header, inheritedEventCount: pa1.inheritedEventCount, events: [...pa1.snapshotEvents()] }))
    const merged = Session.create(SessionId('merged-pa9'), seed)

    const dto = projectSession({ session: merged.header, inheritedEventCount: merged.inheritedEventCount, events: [...merged.snapshotEvents()] })
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
    const dto = projectSession({ session: plain.header, inheritedEventCount: plain.inheritedEventCount, events: [...plain.snapshotEvents()] })
    expect(dto.mergeSources).toBeUndefined()
    expect(readMergeLineage(plain.snapshotEvents())).toBeUndefined()
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
