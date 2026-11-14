// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphView, type GraphViewInjected, type ProjectGraphLoad } from '../src/client/GraphView.tsx'
import { apply } from '../src/client/index.ts'
import { ContextTrayChannel } from '../src/client/context-tray-channel.ts'
import { nodeLabelMap } from '../src/client/labels.ts'
import { assembleProjectGraph } from '../src/client/project-graph.ts'
import { GraphRepository } from '../src/client/repository.ts'
import { EMPTY_GRAPH_STATE, type GraphState, type ImportedTurn } from '../src/client/types.ts'
import { PROJECT_GRAPH_RPC_ENDPOINT, type ProjectGraphResponse } from '../src/protocol.ts'

afterEach(cleanup)

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', TestResizeObserver)

const turn = (number: number, text: string, inherited = false) => ({
  turn: number, prompt: `P${text}`, answer: `A${text}`, startedAt: number * 10, completedAt: number * 10 + 1,
  boundarySeq: number * 6 - 1, inherited, fingerprint: `fp-${text}`,
})

/** `root` wrote three turns; `fork` is an official fork taken after the second. */
const RESPONSE: ProjectGraphResponse = {
  workspaceId: 'project',
  sessions: [
    { sessionId: 'root', createdAt: 1, seedLength: 0, turns: [turn(1, '1'), turn(2, '2'), turn(3, '3-root')] },
    {
      sessionId: 'fork', createdAt: 25, seedLength: 12, parentSessionId: 'root',
      turns: [turn(1, '1', true), turn(2, '2', true), turn(3, '3-fork')],
    },
  ],
}

const FORK_TURNS: readonly ImportedTurn[] = [
  { turn: 1, prompt: 'P1', answer: 'A1', createdAt: 10, boundarySeq: 5 },
  { turn: 2, prompt: 'P2', answer: 'A2', createdAt: 20, boundarySeq: 11 },
  { turn: 3, prompt: 'P3-fork', answer: 'A3-fork', createdAt: 30, boundarySeq: 19 },
]

function closedTimeline(turns: readonly ImportedTurn[]) {
  return {
    turnOrder: turns.map(item => item.turn),
    turns: new Map(turns.map(item => [item.turn, {
      status: 'closed',
      start: { seq: item.boundarySeq - 3, time: item.createdAt },
      end: { seq: item.boundarySeq, time: item.createdAt + 1 },
    }])),
  }
}

function conversationNodes(turns: readonly ImportedTurn[]) {
  return turns.flatMap(item => [
    { kind: 'user', seq: item.boundarySeq - 2, content: [{ type: 'text', text: item.prompt }] },
    { kind: 'assistant', seq: item.boundarySeq - 1, blocks: [{ kind: 'text', text: item.answer }] },
  ])
}

function renderForkView(loadProjectGraph: GraphViewInjected['loadProjectGraph']) {
  const calls: string[] = []
  const chat = { timeline: closedTimeline(FORK_TURNS), legacy: { nodes: conversationNodes(FORK_TURNS), partial: null, runningCalls: [] } }
  const input = { draft: '', draftRev: 0, phase: 'plain', attachmentIds: [], occurrences: [] }
  const props = {
    sessionId: 'fork',
    useSession: (selector: (value: unknown) => unknown) => selector({ running: false }),
    useChat: (selector: (value: unknown) => unknown) => selector(chat),
    useInput: (selector: (value: unknown) => unknown) => selector(input),
    inputActions: { submit: vi.fn() },
    useGraph: (selector: (value: GraphState) => unknown) => selector(EMPTY_GRAPH_STATE),
    syncTurns: vi.fn(() => { calls.push('sync') }),
    adoptObservedGraph: vi.fn(() => { calls.push('adopt') }),
    loadProjectGraph,
    loadHistoryPreview: vi.fn(async () => ({ turns: [] })),
    loadPreviewImage: vi.fn(async () => ({ url: 'blob:test', release: vi.fn() })),
    tray: new ContextTrayChannel(),
    setComposerBlocked: vi.fn(() => true),
    activateAnchor: vi.fn(),
    cancelAnchor: vi.fn(),
    createMergedSession: vi.fn(),
  }
  render(<GraphView {...(props as never)} />)
  return { calls, props }
}

describe('order of the Workspace graph and a Session\'s own turns', () => {
  it('adopts the Workspace graph before importing the turns the Chat shows', async () => {
    let resolve!: (value: ProjectGraphLoad) => void
    const { calls } = renderForkView(() => new Promise<ProjectGraphLoad>((done) => { resolve = done }))

    // Importing first would number the fork's copied turns as PAs of their own.
    expect(calls).toEqual([])
    await act(async () => { resolve({ response: RESPONSE, sessionTitles: {} }) })

    expect(calls.slice(0, 2)).toEqual(['adopt', 'sync'])
  })

  it('imports the turns all the same when there is no Workspace graph to wait for', async () => {
    const unavailable = renderForkView(async () => { throw new Error('Host unavailable') })
    await act(async () => {})
    expect(unavailable.calls).toEqual(['sync'])
    expect(unavailable.props.syncTurns).toHaveBeenCalledWith(FORK_TURNS)
    cleanup()

    const outside = renderForkView(async () => null)
    await act(async () => {})
    expect(outside.calls).toEqual(['sync'])
  })
})

describe('an official fork first opened in the browser', () => {
  it('spends no PA number on the turns it copied', () => {
    const repository = new GraphRepository()
    repository.adoptObservedGraph(assembleProjectGraph(RESPONSE, repository.getSnapshot()).state)
    repository.syncSession('fork', FORK_TURNS, { fork: 'root' })

    const state = repository.getSnapshot()
    const labels = nodeLabelMap(state)
    expect(Object.values(state.nodes).map(node => labels.get(node.id)).sort()).toEqual([
      'PA1', 'PA2', 'PA2 fork', 'PA3', 'PA4',
    ])
    expect(state.sessionTurnRefs.fork![1]).toBe(state.sessionTurnRefs.root![1])
  })
})

/** A browser on a Harness whose session list records no parent for official forks. */
function browser() {
  const registrations: Array<Record<string, unknown>> = []
  const rpcCall = vi.fn(async (_channel: string, endpoint: string, payload: Record<string, unknown>) => {
    if (endpoint === 'graph/read') return { ok: true, value: { scopeId: payload.scopeId, state: null } }
    if (endpoint === 'graph/write') return { ok: true, value: { scopeId: payload.scopeId } }
    if (endpoint === PROJECT_GRAPH_RPC_ENDPOINT) return { ok: true, value: RESPONSE }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  const ctx = {
    slots: {
      inject: vi.fn((_name: string, install: () => unknown) => install()),
      register: vi.fn((registration: Record<string, unknown>) => {
        registrations.push(registration)
        return () => {}
      }),
    },
    effect: vi.fn(),
    sessions: {
      list: { getSnapshot: () => ({
        ids: ['root', 'fork'],
        byId: { root: { id: 'root', displayTitle: 'Root' }, fork: { id: 'fork', displayTitle: 'Fork' } },
      }) },
      binding: () => undefined,
    },
    workspaces: {
      list: { getSnapshot: () => ({ phase: 'ready', items: [{
        workspaceId: 'project', title: 'Project', path: '/project', sessionIds: ['root', 'fork'],
      }] }) },
    },
    connection: { rpc: { call: rpcCall } },
    uiWorkspace: { openSession: vi.fn() },
    locale: {},
    conversation: { blocks: {}, input: { for: vi.fn() } },
  } as unknown as Context
  apply(ctx)
  const inject = registrations.find(entry => entry.name === 'conversation.view')!
    .inject as (sessionId: string) => GraphViewInjected
  return { view: (sessionId: string) => inject(sessionId) }
}

describe('fork origins reported by the Host', () => {
  it('fold copies the ledger already numbered into the origin\'s PAs', async () => {
    const { view } = browser()
    const root = view('root')
    const fork = view('fork')
    await vi.waitFor(() => expect(fork.hooks.graph.ready).toBe(true))
    const ledger = (): GraphState => fork.hooks.graph.getSnapshot()

    // A ledger written while the fork's origin was unknown: every turn is its own PA.
    root.syncTurns(RESPONSE.sessions[0]!.turns.map(item => ({
      turn: item.turn, prompt: item.prompt, answer: item.answer, createdAt: item.startedAt, boundarySeq: item.boundarySeq,
    })))
    fork.syncTurns(FORK_TURNS)
    expect(Object.keys(ledger().nodes)).toHaveLength(6)
    expect(ledger().sessionTurnRefs.fork![1]).not.toBe(ledger().sessionTurnRefs.root![1])

    await fork.loadProjectGraph(new AbortController().signal)
    fork.syncTurns(FORK_TURNS)

    expect(ledger().sessionTurnRefs.fork![1]).toBe(ledger().sessionTurnRefs.root![1])
    const tip = ledger().nodes[ledger().sessionTurnRefs.fork![2]!]!
    expect(tip.forkSourceId).toBe(ledger().sessionTurnRefs.root![2])
    // Three PAs of root, the fork's own turn, and one fork occurrence at the tip.
    expect(Object.keys(ledger().nodes)).toHaveLength(5)
  })
})
