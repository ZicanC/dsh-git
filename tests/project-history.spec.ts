import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { projectSession, projectTurns } from '../src/project-history.ts'
import { decodeProjectGraphRequest, decodeProjectGraphResponse } from '../src/protocol.ts'

function completed(session: Session, turn: number, prompt: string, answer: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn, step: 1,
    message: createAssistantMessage({ content: [{ type: 'text', text: answer }], source: { provider: 'mock', model: 'mock' } }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('project history protocol', () => {
  it('extracts completed PAs, ignores an open turn, and marks the seed prefix', () => {
    const source = Session.create(SessionId('source'))
    completed(source, 1, 'P1', 'A1')
    const child = Session.create(SessionId('child'), source.events, {
      version: 0, id: SessionId('child'), createdAt: 100,
      parentSession: source.id, seedLength: source.events.length,
    })
    completed(child, 2, 'P2', 'A2')
    child.append('turn/start', { turn: 3 })
    child.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'open' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const snapshot = { session: child.header, events: [...child.events] }
    const turns = projectTurns(snapshot)
    expect(turns.map(turn => [turn.turn, turn.prompt, turn.answer, turn.inherited])).toEqual([
      [1, 'P1', 'A1', true],
      [2, 'P2', 'A2', false],
    ])
    expect(projectSession(snapshot)).toMatchObject({ sessionId: 'child', parentSessionId: 'source', seedLength: source.events.length })
    expect(turns[0]?.fingerprint).toHaveLength(64)
  })

  it('strictly rejects malformed request and response payloads', () => {
    expect(() => decodeProjectGraphRequest({ workspaceId: '' })).toThrow(/workspaceId/)
    expect(() => decodeProjectGraphResponse({ workspaceId: 'w', sessions: [{ sessionId: 's' }] })).toThrow(/createdAt/)
    expect(decodeProjectGraphRequest({ workspaceId: 'w' })).toEqual({ workspaceId: 'w' })
  })
})
