import { describe, expect, it, vi } from 'vitest'
import { EMPTY_GRAPH_STATE, type GraphState } from '../src/graph-state.ts'
import { finalizeGraph, identityOf } from '../src/graph-ledger.ts'
import { graphStateSchema } from '../src/graph-domain.ts'
import { GraphRepository } from '../src/client/repository.ts'
import { connectionGraphTransport } from '../src/client/graph-transport.ts'
import { contextReferences, joinsLineages, lineageParentPlan, resolveContextReferences } from '../src/client/graph.ts'
import { nodeLabelMap } from '../src/client/labels.ts'
import { assembleProjectGraph } from '../src/client/project-graph.ts'
import { apply } from '../src/index.ts'
import { graph, node, MemoryTransport } from './fixtures.ts'

const turn = (time: number) => ({ turn: 1, prompt: 'q', answer: 'a', createdAt: time, boundarySeq: 5 })

describe('graph correctness boundaries', () => {
  it('clears a transient save error after the latest complete snapshot saves', async () => {
    const transport = new MemoryTransport()
    const write = transport.write.bind(transport)
    transport.write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(write)
    const repository = new GraphRepository(transport, 'w')
    await repository.hydrate()
    repository.syncSession('first', [turn(1)])
    await vi.waitFor(() => expect(repository.persistenceError?.message).toBe('offline'))
    repository.syncSession('second', [turn(2)])
    await vi.waitFor(() => expect(repository.persistenceError).toBeNull())
    expect(Object.keys(transport.scopes.get('w')!.sessionTurnRefs)).toEqual(['first', 'second'])
  })

  it('retries a failed hydration without overwriting the old ledger or losing deferred observations', async () => {
    const seed = new GraphRepository()
    seed.syncSession('old', [turn(1)])
    const transport = new MemoryTransport({ w: seed.getSnapshot() })
    const read = transport.read.bind(transport)
    transport.read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(read)
    const repository = new GraphRepository(transport, 'w')
    repository.syncSession('new', [turn(2)])
    await expect(repository.hydrate()).rejects.toThrow('offline')
    expect(transport.writes).toBe(0)
    await repository.hydrate()
    expect(Object.keys(transport.scopes.get('w')!.sessionTurnRefs).sort()).toEqual(['new', 'old'])
  })

  it('uses the selected history path for shared fork prefixes, and rejects duplicate or missing identities', () => {
    const one = node({ id: 'one', sessionId: 'S', turn: 1 })
    const two = node({ id: 'two', sessionId: 'S', turn: 2, primaryParentId: 'one', parentIds: ['one'] })
    const fork = node({ ...two, id: 'fork', sessionId: 'T', primaryParentId: null, parentIds: [], forkSourceId: 'two' })
    const three = node({ id: 'three', sessionId: 'T', turn: 3, primaryParentId: 'fork', parentIds: ['fork'] })
    const state = graph([one, two, fork, three], { sessionTurnRefs: { S: { 1: 'one', 2: 'two' }, T: { 1: 'one', 2: 'fork', 3: 'three' } } })
    const refs = contextReferences(state, ['one', 'three'], { one: 'T', three: 'T' })
    expect(joinsLineages(state, ['one', 'three'], refs)).toBe(false)
    expect(lineageParentPlan(state, ['one', 'three'], refs)).toEqual({ parentIds: ['three'], primaryParentId: 'three' })
    expect(() => resolveContextReferences(state, [refs[0]!, refs[0]!])).toThrow(/Duplicate/)
    expect(() => resolveContextReferences(state, [{ ...refs[0]!, viaSessionId: 'empty' }])).toThrow(/history/)
  })

  it('keeps PA numbers through late observations, scope imports, and reloads', async () => {
    const transport = new MemoryTransport()
    const repository = new GraphRepository(transport, 'w')
    await repository.hydrate()
    repository.syncSession('newer', [turn(100)])
    const id = repository.getSnapshot().sessionTurnRefs.newer![1]!
    const label = nodeLabelMap(repository.getSnapshot()).get(id)
    const foreign = new GraphRepository()
    foreign.syncSession('older', [turn(1)])
    repository.adoptObservedGraph(foreign.getSnapshot())
    const restored = new GraphRepository(transport, 'w')
    await restored.hydrate()
    expect(nodeLabelMap(restored.getSnapshot()).get(id)).toBe(label)
    expect(new Set(Object.values(restored.getSnapshot().nodes).map(n => n.ledgerOrdinal)).size).toBe(2)
    expect(() => graphStateSchema.parse(restored.getSnapshot())).not.toThrow()
  })

  it('finalizes late dependencies after existing events, with parents before children', () => {
    const waiting = node({ id: 'waiting', sessionId: 'a', createdAt: 0, primaryParentId: 'parent', parentIds: ['parent'] })
    const root = node({ id: 'root', sessionId: 'b', createdAt: 10 })
    const initial = finalizeGraph(graph([waiting, root]))
    expect(initial.nodes.waiting!.finalOrdinal).toBeUndefined()
    const parent = node({ id: 'parent', sessionId: 'a', turn: 2, createdAt: 1 })
    const complete = finalizeGraph({ ...initial, nodes: { ...initial.nodes, parent } })
    expect(complete.nodes.root!.finalOrdinal).toBe(initial.nodes.root!.finalOrdinal)
    expect(complete.nodes.parent!.finalOrdinal).toBeGreaterThan(complete.nodes.root!.finalOrdinal!)
    expect(complete.nodes.waiting!.finalOrdinal).toBeGreaterThan(complete.nodes.parent!.finalOrdinal!)
  })

  it('preserves the original Context on a projected fork and leaves unrecoverable requests unknown', () => {
    const one = node({ id: 'one', sessionId: 'S', turn: 1, contextKnown: true })
    const two = node({ id: 'two', sessionId: 'S', turn: 2, parentIds: ['one'], primaryParentId: 'one', contextManifest: ['one'], contextKnown: true })
    const local = graph([one, two], { sessionTurnRefs: { S: { 1: 'one', 2: 'two' } } })
    const t = (n: number, inherited = false) => ({ turn: n, prompt: `q${n}`, answer: `a${n}`, startedAt: n, completedAt: n + 1, boundarySeq: n * 5, fingerprint: String(n), inherited })
    const model = assembleProjectGraph({ workspaceId: 'w', sessions: [
      { sessionId: 'S', createdAt: 1, seedLength: 0, turns: [t(1), t(2)] },
      { sessionId: 'T', parentSessionId: 'S', createdAt: 5, seedLength: 10, turns: [t(1, true), t(2, true), t(3)] },
    ] }, local)
    const fork = model.nodes[model.state.sessionTurnRefs.T![2]!]!
    expect(fork.contextManifest).toEqual(['one'])
    expect(fork.contextKnown).toBe(true)
    expect(fork.ledgerOrdinal).toBe(model.nodes.two!.ledgerOrdinal)
    expect(model.nodes[model.state.sessionTurnRefs.T![3]!]!.contextKnown).toBe(false)
  })

  it('rejects malformed graph dependencies and identity duplicates as whole writes', () => {
    const a = node({ id: 'a', sessionId: 'S', turn: 1 })
    const b = node({ id: 'b', sessionId: 'S', turn: 2, primaryParentId: 'a', parentIds: ['a'] })
    expect(() => graphStateSchema.parse(graph([{ ...a, primaryParentId: 'a', parentIds: ['a'] }]))).toThrow(/Self/)
    expect(() => graphStateSchema.parse(graph([{ ...a, primaryParentId: 'b', parentIds: ['b'] }, b]))).toThrow(/Cyclic/)
    expect(() => graphStateSchema.parse(graph([a, { ...b, contextManifest: ['a', 'a'] }]))).toThrow(/Duplicate/)
    expect(() => graphStateSchema.parse(graph([a, { ...b, primaryParentId: null }]))).toThrow(/Primary/)
    expect(() => graphStateSchema.parse(graph([a, { ...b, parentIds: ['missing'], primaryParentId: 'missing' }]))).toThrow(/Missing/)
    const state = graph([a, b])
    expect(() => graphStateSchema.parse(graph([a, { ...b, paId: identityOf(state, a.id) }]))).toThrow(/Duplicate/)
  })
})

describe('Host graph compare-and-swap', () => {
  it('serializes competing clients and refuses stale writes without erasing the first writer', async () => {
    let stored: GraphState | undefined
    let handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
    await apply({
      workspaceRegistry: { list: () => [] }, sessionQuery: { listSessions: async () => [] },
      storageDomain: { open: async () => ({ close: async () => {}, table: () => ({
        get: () => stored, put: async (_id: string, state: GraphState) => {
          await new Promise(resolve => setTimeout(resolve, 1))
          stored = state
        },
      }) }) },
      connection: { rpc: { handle: (_channel: string, callback: typeof handler) => { handler = callback } } },
      effect: () => {},
    } as never)
    const connection = { rpc: { call: async (_channel: string, endpoint: string, payload: unknown) => handler(endpoint, payload, new AbortController().signal) } }
    const left = connectionGraphTransport(connection as never)
    const right = connectionGraphTransport(connection as never)
    await Promise.all([left.read('w'), right.read('w')])
    const results = await Promise.allSettled([
      left.write('w', graph([node({ id: 'left', sessionId: 'left' })])),
      right.write('w', graph([node({ id: 'right', sessionId: 'right' })])),
    ])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(Object.keys(stored!.nodes)).toEqual(['left'])
    expect(stored!.revision).toBe(1)
    await expect(right.write('w', EMPTY_GRAPH_STATE)).rejects.toThrow(/another client/)
    expect(Object.keys(stored!.nodes)).toEqual(['left'])
  })
})
