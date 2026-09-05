import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  cancelAnchorWorkspace, createAnchorWorkspace, createAnchoredSession, createMergedSession,
  readProjectGraph,
} from '../src/index.ts'
import { mergeLineageEvent, readMergeLineage } from '../src/merge-lineage.ts'

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
  it('inherits parent, cwd, effective preset, and Workspace from the final tray source without command events', async () => {
    const first = completedTurn('first-source', 'P1', 'A1')
    const primary = completedTurn('final-source', 'P2', 'A2')
    primary.append('agent-preset/selected', { agentPreset: 'final-preset' })
    const firstEvents = [...first.snapshotEvents()]
    const primaryEvents = [...primary.snapshotEvents()]
    const snapshots = new Map([
      [first.id, { session: { ...first.header, cwd: '/workspace/first', agentPreset: 'first-preset' }, events: firstEvents }],
      [primary.id, {
        session: { ...primary.header, cwd: '/workspace/final', agentPreset: 'creation-preset' },
        events: primaryEvents,
      }],
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
        sourceBoundarySeq: boundary(session.snapshotEvents()),
      })),
    }
    const response = await createMergedSession(ctx, request, new AbortController().signal)

    expect(response).toEqual({ targetSessionId: 'merged-child' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(createOptions?.sessionId).toBe('merged-child')
    expect(createOptions?.inheritedEventCount).toBe((createOptions?.seed as readonly SessionEvent[]).length)
    expect(createOptions?.meta).toEqual({
      cwd: '/workspace/final',
      parentSession: 'final-source',
      isSeeded: true,
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
    expect(first.snapshotEvents()).toEqual(firstEvents)
    expect(primary.snapshotEvents()).toEqual(primaryEvents)
    expect([...first.snapshotEvents(), ...primary.snapshotEvents()].some(event =>
      event.type === 'command/run' || event.type === 'command/done')).toBe(false)
  })

  it('disposes a just-created merged Session when Workspace attachment fails', async () => {
    const source = completedTurn('source', 'P1', 'A1')
    const dispose = vi.fn(async () => undefined)
    const attachSession = vi.fn(async () => { throw new Error('attach failed') })
    const ctx = {
      agents: {
        get: vi.fn(() => undefined),
        create: vi.fn(async () => ({ dispose })),
      },
      agentPresets: { mount: vi.fn(async () => undefined) },
      sessionQuery: {
        readSession: vi.fn(async () => ({
          session: { ...source.header, cwd: '/workspace/source' },
          events: [...source.snapshotEvents()],
        })),
      },
      workspaceRegistry: {
        list: () => [{ sessionIds: [source.id], attachSession }],
      },
    } as unknown as Context

    await expect(createMergedSession(ctx, {
      targetSessionId: 'merged-child',
      sources: [{
        sourceSessionId: source.id,
        sourceTurn: 1,
        sourceBoundarySeq: boundary(source.snapshotEvents()),
      }],
    }, new AbortController().signal)).rejects.toThrow('attach failed')

    expect(dispose).toHaveBeenCalledTimes(1)
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

describe('trusted anchored-session RPC', () => {
  it('creates an independent child inside the requested Anchor Workspace', async () => {
    const source = completedTurn('anchor-source', 'fixed prompt', 'fixed answer')
    const mount = vi.fn(async () => undefined)
    const attachSession = vi.fn(async () => undefined)
    let createOptions: Record<string, unknown> | undefined
    const create = vi.fn(async (options: Record<string, unknown>) => {
      createOptions = options
      await (options.setup as ((ctx: Context) => Promise<void>))({} as Context)
      return {}
    })
    const ctx = {
      agents: { get: vi.fn(() => undefined), create },
      agentPresets: { mount },
      sessionQuery: {
        readSession: vi.fn(async () => ({
          session: { ...source.header, cwd: '/source', agentPreset: 'anchor-preset' },
          events: [...source.snapshotEvents()],
        })),
      },
      workspaceRegistry: {
        list: () => [{
          id: 'anchor-workspace',
          path: '/source/dsh-git-anchors-test',
          sessionIds: [],
          attachSession,
        }],
      },
    } as unknown as Context

    const response = await createAnchoredSession(ctx, {
      targetSessionId: 'dsh-git-anchor-child',
      workspaceId: 'anchor-workspace',
      sources: [{
        sourceSessionId: source.id,
        sourceTurn: 1,
        sourceBoundarySeq: boundary(source.snapshotEvents()),
        sourceLabel: 'PA4',
      }],
    }, new AbortController().signal)

    expect(response).toEqual({ targetSessionId: 'dsh-git-anchor-child' })
    expect(createOptions?.meta).toMatchObject({
      cwd: '/source/dsh-git-anchors-test',
      parentSession: 'anchor-source',
      agentPreset: 'anchor-preset',
    })
    expect(attachSession).toHaveBeenCalledWith('dsh-git-anchor-child')
    expect(readMergeLineage(createOptions?.seed as readonly SessionEvent[])?.sources[0]?.sourceLabel)
      .toBe('PA4')
    expect(Session.create(
      SessionId('dsh-git-anchor-child'),
      createOptions?.seed as readonly SessionEvent[],
    ).deriveMessages().map(message => message.content[0])).toEqual([
      { type: 'text', text: 'fixed prompt' },
      { type: 'text', text: 'fixed answer' },
    ])
  })

  it('rejects an ordinary target id and a missing Anchor Workspace before creation', async () => {
    const create = vi.fn()
    const ctx = {
      agents: { get: vi.fn(() => undefined), create },
      workspaceRegistry: { list: () => [] },
    } as unknown as Context
    const sources = [{
      sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 1, sourceLabel: 'PA1',
    }]

    await expect(createAnchoredSession(ctx, {
      targetSessionId: 'ordinary-child', workspaceId: 'missing', sources,
    }, new AbortController().signal)).rejects.toThrow(/must start/)
    await expect(createAnchoredSession(ctx, {
      targetSessionId: 'dsh-git-anchor-child', workspaceId: 'missing', sources,
    }, new AbortController().signal)).rejects.toThrow(/was not found/)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('trusted Anchor Workspace RPC', () => {
  it('creates and registers a unique direct child of the source Workspace', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'dsh-git-anchor-project-'))
    const create = vi.fn(async (path: string, title: string) => ({
      id: 'anchor-workspace', path, title, sessionIds: [],
    }))
    const ctx = {
      workspaceRegistry: {
        list: () => [{
          id: 'source-workspace', path: projectPath, title: 'Project',
          sessionIds: [SessionId('source')],
        }],
        create,
      },
    } as unknown as Context

    try {
      const response = await createAnchorWorkspace(ctx, {
        sourceSessionId: 'source',
        title: 'Anchored questions · Project',
        sources: [{ sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 6 }],
      }, new AbortController().signal)

      expect(dirname(response.workspacePath)).toBe(projectPath)
      expect(basename(response.workspacePath)).toMatch(/^dsh-git-anchors-/)
      expect(response).toMatchObject({
        workspaceId: 'anchor-workspace',
        workspaceTitle: 'Anchored questions · Project',
      })
      expect(create).toHaveBeenCalledWith(
        response.workspacePath,
        'Anchored questions · Project',
      )
      expect((await stat(response.workspacePath)).isDirectory()).toBe(true)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('reuses the same Anchor Workspace for the same node set in any selection order', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'dsh-git-anchor-project-'))
    const sourceWorkspace = {
      id: 'source-workspace', path: projectPath, title: 'Project',
      sessionIds: [SessionId('source')],
    }
    let anchorWorkspace: Record<string, unknown> | undefined
    const create = vi.fn(async (path: string, title: string) => {
      anchorWorkspace = { id: 'anchor-workspace', path, title, sessionIds: [] }
      return anchorWorkspace
    })
    const ctx = {
      workspaceRegistry: {
        list: () => [sourceWorkspace, ...(anchorWorkspace === undefined ? [] : [anchorWorkspace])],
        create,
      },
    } as unknown as Context
    const first = { sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 6 }
    const second = { sourceSessionId: 'source', sourceTurn: 3, sourceBoundarySeq: 18 }

    try {
      const created = await createAnchorWorkspace(ctx, {
        sourceSessionId: 'source', title: 'Anchored questions · Project',
        sources: [first, second],
      }, new AbortController().signal)
      const resumed = await createAnchorWorkspace(ctx, {
        sourceSessionId: 'source', title: 'A later localized title',
        sources: [second, first],
      }, new AbortController().signal)

      expect(resumed).toEqual(created)
      expect(create).toHaveBeenCalledTimes(1)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('recovers and reuses a pre-identity Anchor Workspace from child lineage', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'dsh-git-anchor-project-'))
    const anchorPath = await mkdtemp(join(projectPath, 'dsh-git-anchors-'))
    const sources = [
      { sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 6 },
      { sourceSessionId: 'other', sourceTurn: 2, sourceBoundarySeq: 12 },
    ]
    await writeFile(join(anchorPath, '.dsh-git-anchor'), JSON.stringify({
      sourceWorkspacePath: projectPath,
    }))
    const create = vi.fn()
    const ctx = {
      logger: { warn: vi.fn() },
      workspaceRegistry: {
        list: () => [{
          id: 'source-workspace', path: projectPath, title: 'Project',
          sessionIds: [SessionId('source')],
        }, {
          id: 'legacy-anchor', path: anchorPath, title: 'Anchored questions · Project',
          sessionIds: [SessionId('dsh-git-anchor-legacy')],
        }],
        create,
      },
      sessionQuery: {
        readSession: vi.fn(async () => ({
          session: { id: SessionId('dsh-git-anchor-legacy') },
          events: [mergeLineageEvent(sources, 0, 1)],
        })),
      },
    } as unknown as Context

    try {
      await expect(createAnchorWorkspace(ctx, {
        sourceSessionId: 'source', title: 'Anchored questions · Project',
        sources: [...sources].reverse(),
      }, new AbortController().signal)).resolves.toEqual({
        workspaceId: 'legacy-anchor',
        workspacePath: anchorPath,
        workspaceTitle: 'Anchored questions · Project',
      })
      expect(create).not.toHaveBeenCalled()
      expect(JSON.parse(await readFile(join(anchorPath, '.dsh-git-anchor'), 'utf8')))
        .toMatchObject({ sourceWorkspacePath: projectPath, anchorKey: expect.any(String) })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('rejects an unknown source before creating a directory', async () => {
    const create = vi.fn()
    const ctx = {
      workspaceRegistry: { list: () => [], create },
    } as unknown as Context

    await expect(createAnchorWorkspace(ctx, {
      sourceSessionId: 'missing', title: 'Anchored questions',
      sources: [{ sourceSessionId: 'missing', sourceTurn: 1, sourceBoundarySeq: 6 }],
    }, new AbortController().signal)).rejects.toThrow(/not in a Workspace/)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects paths and other unexpected browser fields', async () => {
    const ctx = { workspaceRegistry: { list: vi.fn() } } as unknown as Context
    await expect(createAnchorWorkspace(ctx, {
      sourceSessionId: 'source', title: 'Anchored questions', path: '/tmp/escape',
      sources: [{ sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 6 }],
    }, new AbortController().signal)).rejects.toThrow(/unexpected field "path"/)
    expect(ctx.workspaceRegistry.list).not.toHaveBeenCalled()
  })

  it('preserves an empty direct Anchor Workspace so the same anchors can resume it', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'dsh-git-anchor-project-'))
    const anchorPath = await mkdtemp(join(projectPath, 'dsh-git-anchors-'))
    const sourceWorkspace = {
      id: 'source-workspace', path: projectPath, title: 'Project', sessionIds: [SessionId('source')],
    }
    const anchorWorkspace = {
      id: 'anchor-workspace', path: anchorPath, title: 'Anchored questions', sessionIds: [],
    }
    await writeFile(join(anchorPath, '.dsh-git-anchor'), JSON.stringify({ sourceWorkspacePath: projectPath }))
    const remove = vi.fn(async () => true)
    const ctx = {
      workspaceRegistry: { list: () => [sourceWorkspace, anchorWorkspace], delete: remove },
    } as unknown as Context

    try {
      await expect(cancelAnchorWorkspace(ctx, {
        sourceSessionId: 'source', workspaceId: 'anchor-workspace',
        sources: [{ sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 6 }],
      }, new AbortController().signal)).resolves.toEqual({ removed: false })
      expect(remove).not.toHaveBeenCalled()
      expect((await stat(anchorPath)).isDirectory()).toBe(true)
      expect(JSON.parse(await readFile(join(anchorPath, '.dsh-git-anchor'), 'utf8')))
        .toMatchObject({ sourceWorkspacePath: projectPath, anchorKey: expect.any(String) })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('preserves an Anchor Workspace that already contains a child Session', async () => {
    const sourceWorkspace = {
      id: 'source-workspace', path: '/project', title: 'Project', sessionIds: [SessionId('source')],
    }
    const anchorWorkspace = {
      id: 'anchor-workspace', path: '/project/dsh-git-anchors-one', title: 'Anchored questions',
      sessionIds: [SessionId('dsh-git-anchor-child')],
    }
    const remove = vi.fn()
    const ctx = {
      workspaceRegistry: { list: () => [sourceWorkspace, anchorWorkspace], delete: remove },
    } as unknown as Context

    await expect(cancelAnchorWorkspace(ctx, {
      sourceSessionId: 'source', workspaceId: 'anchor-workspace',
    }, new AbortController().signal)).resolves.toEqual({ removed: false })
    expect(remove).not.toHaveBeenCalled()
  })

  it('does not unregister a similarly named Workspace without the Host marker', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'dsh-git-anchor-project-'))
    const workspacePath = await mkdtemp(join(projectPath, 'dsh-git-anchors-'))
    const sourceWorkspace = {
      id: 'source-workspace', path: projectPath, title: 'Project', sessionIds: [SessionId('source')],
    }
    const workspace = { id: 'other-workspace', path: workspacePath, title: 'Other', sessionIds: [] }
    const remove = vi.fn()
    const ctx = {
      workspaceRegistry: { list: () => [sourceWorkspace, workspace], delete: remove },
    } as unknown as Context

    try {
      await expect(cancelAnchorWorkspace(ctx, {
        sourceSessionId: 'source', workspaceId: 'other-workspace',
      }, new AbortController().signal)).resolves.toEqual({ removed: false })
      expect(remove).not.toHaveBeenCalled()
      expect((await stat(workspacePath)).isDirectory()).toBe(true)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })
})

describe('Anchor Workspace project graph', () => {
  it('includes anchored children in their dedicated Workspace graph', async () => {
    const child = completedTurn('dsh-git-anchor-child', 'parallel question', 'isolated answer')
    const ctx = {
      workspaceRegistry: {
        list: () => [{
          id: 'anchor-workspace', path: '/project/dsh-git-anchors-test',
          title: 'Anchored questions', sessionIds: [child.id],
        }],
      },
      sessionQuery: {
        readSession: vi.fn(async () => ({ session: child.header, inheritedEventCount: child.inheritedEventCount, events: [...child.snapshotEvents()] })),
      },
    } as unknown as Context

    const response = await readProjectGraph(ctx, { workspaceId: 'anchor-workspace' })

    expect(response.value).toMatchObject({
      workspaceId: 'anchor-workspace',
      sessions: [{
        sessionId: 'dsh-git-anchor-child',
        turns: [{ prompt: 'parallel question', answer: 'isolated answer' }],
      }],
    })
  })
})
