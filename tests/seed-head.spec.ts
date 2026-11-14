import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { buildMergedSessionSeed, effectiveSystemMessage } from '../src/history.ts'
import { projectHistoryPreview } from '../src/history-preview.ts'

const user = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const assistant = (text: string) => createAssistantMessage({
  content: [{ type: 'text', text }], source: { provider: 'mock', model: 'mock' },
})

/** One completed turn in the order the current loop writes it: the prompt enters inside the step. */
function appendTurn(session: Session, turn: number, question: string, answer: string, system?: string): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  if (system !== undefined) {
    session.append('system/message', { turn, step: 1, message: createSystemMessage(system) }, { surfaceOp: 'append' })
  }
  session.append('user/message', user(question), { surfaceOp: 'append' })
  session.append('assistant/message', { turn, step: 1, stream: [], message: assistant(answer) }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function reader(...sessions: Session[]) {
  const byId = new Map(sessions.map(session => [String(session.id), session]))
  return async (sessionId: string) => {
    const session = byId.get(sessionId)
    if (session === undefined) throw new Error(`missing fixture session ${sessionId}`)
    return { session: session.header, inheritedEventCount: session.inheritedEventCount, events: [...session.snapshotEvents()] }
  }
}

function turnEnd(session: Session, turn: number): number {
  const event = session.snapshotEvents().find(candidate => candidate.type === 'turn/end' && candidate.data.turn === turn)
  if (event === undefined) throw new Error(`fixture has no end for turn ${turn}`)
  return event.seq
}

function source(session: Session, turn: number) {
  return { sourceSessionId: String(session.id), sourceTurn: turn, sourceBoundarySeq: turnEnd(session, turn) }
}

/** The seed's surface events in log order, as `type` or `type:text`. */
function surfaceOf(seed: readonly SessionEvent[]): string[] {
  return seed.flatMap((event) => {
    if (event.type === 'system/message') {
      const [block] = event.data.message.content
      return [`system:${block?.type === 'text' ? block.text : ''}`]
    }
    if (event.type === 'user/message') return ['user']
    if (event.type === 'assistant/message') return ['assistant']
    return []
  })
}

/** Rebuild the child as Harness does and let its first request write the child's own system prompt. */
function childAfterFirstRequest(seed: readonly SessionEvent[], prompt: string): Session {
  const child = Session.create(SessionId('child'), seed, {
    version: Session.create(SessionId('probe')).header.version,
    id: SessionId('child'), createdAt: 1, isSeeded: true,
  }, SessionLogOffset(seed.length))
  const turn = seed.filter(event => event.type === 'turn/start').length + 1
  child.append('turn/start', { turn })
  child.append('step/start', { turn, step: 1 })
  child.append('system/message', { turn, step: 1, message: createSystemMessage(prompt) }, { surfaceOp: 'append' })
  return child
}

/**
 * The rule Harness applies when it reads a stored log back: a system message
 * on a non-empty surface needs a system message as the surface's first node.
 */
function hasProtectedHead(events: readonly SessionEvent[]): boolean {
  const first = events.find(event => 'surfaceOp' in event && event.surfaceOp === 'append')
  return first?.type === 'system/message'
}

describe('merged seed system head', () => {
  it('opens the surface with the source system prompt, inside the first copied step', async () => {
    const original = Session.create(SessionId('original'))
    appendTurn(original, 1, 'P1', 'A1', 'PROMPT')
    appendTurn(original, 2, 'P2', 'A2')

    const seed = await buildMergedSessionSeed('child', [source(original, 1), source(original, 2)], reader(original))

    expect(surfaceOf(seed)).toEqual(['system:PROMPT', 'user', 'assistant', 'user', 'assistant'])
    const head = seed.find(event => event.type === 'system/message')!
    expect(head.data).toMatchObject({ turn: 1, step: 1 })
    expect(seed[head.seq - 1]).toMatchObject({ type: 'step/start', data: { turn: 1, step: 1 } })
    // The log stays readable after the child's first request adds its own prompt.
    expect(hasProtectedHead(childAfterFirstRequest(seed, 'CHILD PROMPT').snapshotEvents())).toBe(true)
  })

  it('carries the prompt in effect for a later turn whose own events hold no system message', async () => {
    const original = Session.create(SessionId('original'))
    appendTurn(original, 1, 'P1', 'A1', 'PROMPT')
    appendTurn(original, 2, 'P2', 'A2')

    const seed = await buildMergedSessionSeed('child', [source(original, 2)], reader(original))

    expect(surfaceOf(seed)).toEqual(['system:PROMPT', 'user', 'assistant'])
    expect(seed.filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1])
  })

  it('takes the prompt from the last source, whose preset the child inherits', async () => {
    const first = Session.create(SessionId('first'))
    appendTurn(first, 1, 'P1', 'A1', 'FIRST PROMPT')
    const last = Session.create(SessionId('last'))
    appendTurn(last, 1, 'P7', 'A7', 'LAST PROMPT')

    const seed = await buildMergedSessionSeed('child', [source(first, 1), source(last, 1)], reader(first, last))

    // One system node only: the other source's prompt is not replayed mid-history.
    expect(surfaceOf(seed)).toEqual(['system:LAST PROMPT', 'user', 'assistant', 'user', 'assistant'])
  })

  it('follows a rewritten head and a later in-history prompt', () => {
    const session = Session.create(SessionId('s'))
    appendTurn(session, 1, 'P1', 'A1', 'OLD')
    const head = session.snapshotEvents().find(event => event.type === 'system/message')!
    session.append('turn/start', { turn: 2 })
    session.append('step/start', { turn: 2, step: 1 })
    const rewritten = session.append('system/message', { turn: 2, step: 1, message: createSystemMessage('REWRITTEN') }, {
      surfaceOp: { op: 'replace', startSeq: head.seq, endSeq: head.seq }, sourceEventSeqs: [head.seq],
    })
    const appended = session.append('system/message', { turn: 2, step: 1, message: createSystemMessage('APPENDED') }, { surfaceOp: 'append' })
    const events = session.snapshotEvents()

    const text = (throughSeq: number) => {
      const [block] = effectiveSystemMessage(events, throughSeq)?.content ?? []
      return block?.type === 'text' ? block.text : undefined
    }
    expect(text(head.seq - 1)).toBeUndefined()
    expect(text(rewritten.seq - 1)).toBe('OLD')
    expect(text(rewritten.seq)).toBe('REWRITTEN')
    expect(text(appended.seq)).toBe('APPENDED')
  })

  it('reserves an empty head when the source log has no system message at all', async () => {
    const original = Session.create(SessionId('original'))
    appendTurn(original, 1, 'P1', 'A1')

    const seed = await buildMergedSessionSeed('child', [source(original, 1)], reader(original))

    expect(surfaceOf(seed)).toEqual(['system:', 'user', 'assistant'])
    // An empty head is "no system prompt": it adds nothing to the model history.
    const child = childAfterFirstRequest(seed, 'CHILD PROMPT')
    expect(hasProtectedHead(child.snapshotEvents())).toBe(true)
    expect(Session.create(SessionId('replay'), seed).deriveMessages().map(message => message.role)).toEqual(['user', 'assistant'])
  })

  it('puts the head ahead of a prompt that an older log wrote before its first step', async () => {
    const older = Session.create(SessionId('older'))
    older.append('turn/start', { turn: 1 })
    older.append('user/message', user('P1'), { surfaceOp: 'append' })
    older.append('step/start', { turn: 1, step: 1 })
    older.append('assistant/message', { turn: 1, step: 1, stream: [], message: assistant('A1') }, { surfaceOp: 'append' })
    older.append('step/end', { turn: 1, step: 1 })
    older.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const seed = await buildMergedSessionSeed('child', [source(older, 1)], reader(older))

    expect(seed.slice(0, 5).map(event => event.type)).toEqual([
      'turn/start', 'step/start', 'system/message', 'user/message', 'assistant/message',
    ])
  })

  it('opens a step for the head when the first selected turn never reached one', async () => {
    const stalled = Session.create(SessionId('stalled'))
    stalled.append('turn/start', { turn: 1 })
    stalled.append('user/message', user('P1'), { surfaceOp: 'append' })
    stalled.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const seed = await buildMergedSessionSeed('child', [source(stalled, 1)], reader(stalled))

    expect(seed.slice(0, 6).map(event => event.type)).toEqual([
      'turn/start', 'step/start', 'system/message', 'user/message', 'step/end', 'turn/end',
    ])
    expect(seed[1]!.data).toEqual({ turn: 1, step: 1 })
    expect(seed[4]!.data).toEqual({ turn: 1, step: 1 })
  })

  it('keeps the head out of the Chat History preview', async () => {
    const original = Session.create(SessionId('original'))
    appendTurn(original, 1, 'P1', 'A1', 'PROMPT')

    const preview = await projectHistoryPreview([source(original, 1)], reader(original))

    expect(preview.turns[0]!.records.map(record => record.kind)).toEqual(['user', 'assistant'])
  })
})
