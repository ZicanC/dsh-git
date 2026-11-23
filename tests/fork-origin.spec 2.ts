import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  Session, SessionId, SessionLogOffset, SessionSeq, buildForkSeed, type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it, vi } from 'vitest'
import { forkOrigin } from '../src/fork-origin.ts'
import { buildMergedSessionSeed } from '../src/history.ts'
import { createMergedSession, readProjectGraph } from '../src/index.ts'
import { decodeProjectGraphResponse } from '../src/protocol.ts'

function completed(session: Session, turn: number, prompt: string, answer: string): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: prompt }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn, step: 1, stream: [],
    message: createAssistantMessage({
      content: [{ type: 'text', text: answer }], source: { provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function turnEnd(session: Session, turn: number): number {
  const end = session.snapshotEvents().find(event => event.type === 'turn/end' && event.data.turn === turn)
  if (end === undefined) throw new Error(`fixture has no end for turn ${turn}`)
  return end.seq
}

/**
 * Fork a Session the way Harness does since 0.2.1-rc.3: the child inherits an
 * exact event prefix and its header names no parent.
 */
function officialFork(source: Session, id: string, throughTurn: number, createdAt: number): Session {
  const boundary = turnEnd(source, throughTurn)
  return Session.create(SessionId(id), buildForkSeed(source.snapshotEvents(), SessionSeq(boundary)), {
    version: source.header.version, id: SessionId(id), createdAt, isSeeded: true,
  }, SessionLogOffset(boundary + 1))
}

function snapshot(session: Session): SessionLogSnapshot {
  return {
    session: session.header,
    inheritedEventCount: session.inheritedEventCount,
    events: [...session.snapshotEvents()],
  }
}

function fixture() {
  const version = Session.create(SessionId('probe')).header.version
  const root = Session.create(SessionId('root'), [], {
    version, id: SessionId('root'), createdAt: 10, isSeeded: false,
  })
  completed(root, 1, 'P1', 'A1')
  completed(root, 2, 'P2', 'A2')
  const fork = officialFork(root, 'fork', 2, 100)
  completed(fork, 3, 'P3 in fork', 'A3 in fork')
  completed(root, 3, 'P3 in root', 'A3 in root')
  return { root, fork }
}

describe('official fork origin', () => {
  it('finds the Session whose log the fork inherited, though the header names no parent', () => {
    const { root, fork } = fixture()
    const unrelated = Session.create(SessionId('unrelated'))
    completed(unrelated, 1, 'P1', 'A1')
    completed(unrelated, 2, 'P2', 'A2')

    expect(fork.header.parentSession).toBeUndefined()
    expect(forkOrigin(snapshot(fork), [snapshot(unrelated), snapshot(fork), snapshot(root)])).toBe('root')
    // Identical wording is not shared history: only a verbatim event prefix counts.
    expect(forkOrigin(snapshot(fork), [snapshot(unrelated)])).toBeUndefined()
    expect(forkOrigin(snapshot(root), [snapshot(fork), snapshot(unrelated)])).toBeUndefined()
  })

  it('attributes a fork to the Session that wrote its tip, not to a sibling that inherited it too', () => {
    const { root, fork } = fixture()
    const sibling = officialFork(root, 'sibling', 2, 50)
    completed(sibling, 3, 'P3 in sibling', 'A3 in sibling')
    // A fork taken inside the prefix `fork` itself inherited belongs to root as well.
    const nested = officialFork(fork, 'nested', 1, 200)

    expect(forkOrigin(snapshot(fork), [snapshot(sibling), snapshot(root)])).toBe('root')
    expect(forkOrigin(snapshot(nested), [snapshot(fork), snapshot(sibling), snapshot(root)])).toBe('root')
    // A fork of the fork's own turn belongs to the fork.
    const grandchild = officialFork(fork, 'grandchild', 3, 300)
    expect(forkOrigin(snapshot(grandchild), [snapshot(root), snapshot(sibling), snapshot(fork)])).toBe('fork')
  })

  it('keeps a recorded parent and never guesses one for a composed Session', () => {
    const { root, fork } = fixture()
    const recorded: SessionLogSnapshot = {
      ...snapshot(fork), session: { ...fork.header, parentSession: SessionId('elsewhere') },
    }
    expect(forkOrigin(recorded, [snapshot(root)])).toBe('elsewhere')
  })
})

function hostContext(sessions: readonly Session[], extra: Record<string, unknown> = {}): Context {
  const byId = new Map(sessions.map(session => [String(session.id), session]))
  const workspace = {
    id: 'workspace', path: '/project', title: 'Project',
    sessionIds: sessions.map(session => session.id), attachSession: vi.fn(async () => undefined),
  }
  return {
    logger: { warn: vi.fn() },
    workspaceRegistry: { list: () => [workspace] },
    sessionQuery: {
      readSession: vi.fn(async (sessionId: string) => {
        const session = byId.get(String(sessionId))
        if (session === undefined) throw new Error(`missing ${sessionId}`)
        return snapshot(session)
      }),
    },
    ...extra,
  } as unknown as Context
}

describe('official forks on a Harness that records no parent', () => {
  it('reports the recovered origin in the Workspace graph', async () => {
    const { root, fork } = fixture()
    const response = await readProjectGraph(hostContext([fork, root]), { workspaceId: 'workspace' })
    const decoded = decodeProjectGraphResponse(response.value)

    expect(decoded.sessions.map(session => [session.sessionId, session.parentSessionId])).toEqual([
      ['root', undefined],
      ['fork', 'root'],
    ])
    expect(decoded.sessions[1]!.turns.map(turn => [turn.turn, turn.inherited])).toEqual([
      [1, true], [2, true], [3, false],
    ])
  })

  it('treats a PA reached through the fork as the origin\'s PA when composing a seed', async () => {
    const { root, fork } = fixture()
    const snapshots = new Map([['root', snapshot(root)], ['fork', snapshot(fork)]])
    const read = async (id: string) => snapshots.get(id)!
    const origin = async (session: SessionLogSnapshot) => forkOrigin(session, snapshots.values())
    const shared = { sourceSessionId: 'root', sourceTurn: 2, sourceBoundarySeq: turnEnd(root, 2) }

    // The fork's history holds root's PA2 exactly once, so it is a valid path to it.
    const seed = await buildMergedSessionSeed('child', [{ ...shared, viaSessionId: 'fork' }], read, origin)
    expect(seed.some(event => event.type === 'turn/end')).toBe(true)
    // Selecting it from root and again from the fork is one PA twice.
    await expect(buildMergedSessionSeed('duplicate', [
      shared, { ...shared, sourceSessionId: 'fork' },
    ], read, origin)).rejects.toThrow(/Duplicate/)
  })

  it('resolves the origin from the Workspace when the merge RPC composes through a fork', async () => {
    const { root, fork } = fixture()
    const create = vi.fn(async (_options: { seed: readonly SessionEvent[] }) => ({ dispose: vi.fn() }))
    const ctx = hostContext([root, fork], {
      agents: { get: vi.fn(() => undefined), create },
      agentPresets: { mount: vi.fn(async () => undefined) },
    })

    await expect(createMergedSession(ctx, {
      targetSessionId: 'dsh-git-child',
      sources: [{
        viaSessionId: 'fork', sourceSessionId: 'root', sourceTurn: 1, sourceBoundarySeq: turnEnd(root, 1),
      }, {
        viaSessionId: 'fork', sourceSessionId: 'fork', sourceTurn: 3, sourceBoundarySeq: turnEnd(fork, 3),
      }],
    }, new AbortController().signal)).resolves.toMatchObject({ targetSessionId: 'dsh-git-child' })
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('Workspace graph with an unreadable Session', () => {
  it('still reports every Session that can be read', async () => {
    const { root, fork } = fixture()
    const ctx = hostContext([root, fork])
    const broken = SessionId('broken')
    ctx.workspaceRegistry.list()[0]!.sessionIds.push(broken)

    const response = await readProjectGraph(ctx, { workspaceId: 'workspace' })
    const decoded = decodeProjectGraphResponse(response.value)

    expect(decoded.sessions.map(session => session.sessionId)).toEqual(['root', 'fork'])
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('broken'))
  })
})
