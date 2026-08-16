import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { createMergedSession } from '../src/index.ts'
import { readMergeLineage } from '../src/merge-lineage.ts'

function completedTurn(sessionId: string, prompt: string, answer: string): Session {
  const session = Session.create(SessionId(sessionId))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
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

function boundary(events: readonly SessionEvent[]): number {
  const end = events.findLast(event => event.type === 'turn/end')
  if (end === undefined) throw new Error('fixture is missing turn/end')
  return end.seq
}

describe('trusted merged-session RPC', () => {
  it('inherits parent, cwd, preset, and Workspace from the final tray source without command events', async () => {
    const first = completedTurn('first-source', 'P1', 'A1')
    const primary = completedTurn('final-source', 'P2', 'A2')
    const firstEvents = [...first.events]
    const primaryEvents = [...primary.events]
    const snapshots = new Map([
      [first.id, { session: { ...first.header, cwd: '/workspace/first', agentPreset: 'first-preset' }, events: firstEvents }],
      [primary.id, { session: { ...primary.header, cwd: '/workspace/final', agentPreset: 'final-preset' }, events: primaryEvents }],
    ])
    const attachFirst = vi.fn(async () => undefined)
    const attachPrimary = vi.fn(async () => undefined)
    const mount = vi.fn(async () => undefined)
    let createOptions: Record<string, unknown> | undefined
    const agentCtx = {} as Context
    const create = vi.fn(async (options: Record<string, unknown>) => {
      createOptions = options
      const setup = options.setup as ((ctx: Context) => Promise<void>) | undefined
      await setup?.(agentCtx)
      return {}
    })
    const ctx = {
      agents: { get: vi.fn(() => undefined), create },
      agentPresets: { mount },
      sessionQuery: {
        readSession: vi.fn(async (sessionId: string) => {
          const snapshot = snapshots.get(SessionId(sessionId))
          if (snapshot === undefined) throw new Error(`missing ${sessionId}`)
          return snapshot
        }),
      },
      workspaceRegistry: {
        list: () => [
          { sessionIds: [first.id], attachSession: attachFirst },
          { sessionIds: [primary.id], attachSession: attachPrimary },
        ],
      },
    } as unknown as Context

    const request = {
      targetSessionId: 'merged-child',
      sources: [first, primary].map(session => ({
        sourceSessionId: session.id,
        sourceTurn: 1,
        sourceBoundarySeq: boundary(session.events),
      })),
    }
    const response = await createMergedSession(ctx, request, new AbortController().signal)

    expect(response).toEqual({ targetSessionId: 'merged-child' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(createOptions?.sessionId).toBe('merged-child')
    expect(createOptions?.meta).toEqual({
      cwd: '/workspace/final',
      parentSession: 'final-source',
      seedLength: (createOptions?.seed as readonly SessionEvent[]).length,
      agentPreset: 'final-preset',
    })
    expect(mount).toHaveBeenCalledWith(agentCtx, 'final-preset')
    expect(attachFirst).not.toHaveBeenCalled()
    expect(attachPrimary).toHaveBeenCalledWith('merged-child')

    const seed = createOptions?.seed as readonly SessionEvent[]
    const merged = Session.create(SessionId('merged-child'), seed)
    expect(merged.deriveMessages().map(message => message.content[0])).toEqual([
      { type: 'text', text: 'P1' },
      { type: 'text', text: 'A1' },
      { type: 'text', text: 'P2' },
      { type: 'text', text: 'A2' },
    ])
    expect(readMergeLineage(seed)?.sources.map(source => source.sourceSessionId))
      .toEqual(['first-source', 'final-source'])
    expect(first.events).toEqual(firstEvents)
    expect(primary.events).toEqual(primaryEvents)
    expect([...first.events, ...primary.events].some(event =>
      event.type === 'command/run' || event.type === 'command/done')).toBe(false)
  })

  it('rejects a duplicate target before reading or creating any source state', async () => {
    const readSession = vi.fn()
    const create = vi.fn()
    const ctx = {
      agents: { get: vi.fn(() => ({})), create },
      sessionQuery: { readSession },
    } as unknown as Context

    await expect(createMergedSession(ctx, {
      targetSessionId: 'already-live',
      sources: [{ sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 1 }],
    }, new AbortController().signal)).rejects.toThrow(/already exists/)
    expect(readSession).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
