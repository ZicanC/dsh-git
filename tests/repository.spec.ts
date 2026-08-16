import { describe, expect, it } from 'vitest'
import { GraphRepository } from '../src/client/repository.ts'
import { nodeLabelMap } from '../src/client/labels.ts'
import { MemoryTransport } from './fixtures.ts'

const turn = (number: number, createdAt = number * 10) => ({
  turn: number,
  prompt: `q${number}`,
  answer: `a${number}`,
  createdAt,
  boundarySeq: number * 5,
})

describe('GraphRepository', () => {
  it('imports a linear session and seeds the tray with the primary path', async () => {
    const transport = new MemoryTransport()
    const repository = new GraphRepository(transport, 'workspace:one')
    await repository.hydrate()
    repository.syncSession('s1', [turn(1), turn(2)])

    const state = repository.getSnapshot()
    const first = state.nodes[state.sessionTurnRefs.s1![1]!]!
    const second = state.nodes[state.sessionTurnRefs.s1![2]!]!
    expect(first.parentIds).toEqual([])
    expect(second.parentIds).toEqual([first.id])
    expect(second.contextManifest).toEqual([first.id])
    expect(state.contextManifest).toEqual([first.id, second.id])
    expect(transport.scopes.get('workspace:one')).toEqual(state)
  })

  it('defers mutations until the Host ledger lands and never mints duplicate nodes', async () => {
    const seeded = new GraphRepository()
    seeded.syncSession('s1', [turn(1), turn(2)])
    const stored = seeded.getSnapshot()
    const transport = new MemoryTransport({ 'workspace:one': stored })

    const repository = new GraphRepository(transport, 'workspace:one')
    // The view renders and syncs before the ledger has arrived.
    repository.syncSession('s1', [turn(1), turn(2)])
    expect(repository.ready).toBe(false)
    expect(Object.keys(repository.getSnapshot().nodes)).toHaveLength(0)

    await repository.hydrate()
    const state = repository.getSnapshot()
    expect(Object.keys(state.nodes)).toHaveLength(2)
    expect(state.sessionTurnRefs.s1![1]).toBe(stored.sessionTurnRefs.s1![1])
    expect(state.sessionTurnRefs.s1![2]).toBe(stored.sessionTurnRefs.s1![2])
  })

  it('opens the gate and rebuilds from the session log when the Host read fails', async () => {
    const transport = new MemoryTransport()
    transport.read = async () => { throw new Error('connection lost') }
    const repository = new GraphRepository(transport, 'workspace:one')
    repository.syncSession('s1', [turn(1)])

    await expect(repository.hydrate()).rejects.toThrow('connection lost')
    expect(repository.ready).toBe(true)
    expect(Object.keys(repository.getSnapshot().nodes)).toHaveLength(1)
  })

  it('adopts unopened Session turns without replacing local graph identity or view state', () => {
    const repository = new GraphRepository()
    repository.syncSession('local', [turn(1)])
    const localBefore = repository.getSnapshot()
    const localNodeId = localBefore.sessionTurnRefs.local![1]!
    const localBranchId = localBefore.sessionBranches.local!
    repository.renameBranch(localBranchId, 'kept-local-name')

    const observedRepository = new GraphRepository()
    observedRepository.syncSession('remote', [{ ...turn(1), prompt: 'remote question' }])
    const observed = observedRepository.getSnapshot()
    const remoteNodeId = observed.sessionTurnRefs.remote![1]!

    repository.adoptObservedGraph(observed)

    const state = repository.getSnapshot()
    expect(state.sessionTurnRefs.local![1]).toBe(localNodeId)
    expect(state.sessionTurnRefs.remote![1]).toBe(remoteNodeId)
    expect(state.nodes[remoteNodeId]?.prompt).toBe('remote question')
    expect(state.branches[localBranchId]?.name).toBe('kept-local-name')
    expect(state.headNodeId).toBe(localNodeId)
    expect(state.contextManifest).toEqual([localNodeId])
  })

  it('keeps a manual tray order when another node is selected', () => {
    const repository = new GraphRepository()
    repository.syncSession('s1', [turn(1), turn(2), turn(3)])
    const state = repository.getSnapshot()
    const one = state.sessionTurnRefs.s1![1]!
    const two = state.sessionTurnRefs.s1![2]!
    const three = state.sessionTurnRefs.s1![3]!
    repository.moveContext(three, one)
    repository.toggleContext(two)
    repository.toggleContext(two)
    expect(repository.getSnapshot().contextManifest).toEqual([three, one, two])
  })

  it('registers imported turns and creates a multi-parent node from the first new official turn', () => {
    const repository = new GraphRepository()
    repository.syncSession('source', [turn(1), turn(2)])
    const before = repository.getSnapshot()
    const one = before.sessionTurnRefs.source![1]!
    const two = before.sessionTurnRefs.source![2]!
    repository.prepareMergedSession({
      childSessionId: 'child',
      importedNodeIds: [one, two],
      parentIds: [one, two],
      primaryParentId: two,
      contextManifest: [two, one],
    })
    const prepared = repository.getSnapshot()
    expect(prepared.sessionTurnRefs.child).toEqual({ 1: one, 2: two })
    expect(prepared.branches[prepared.sessionBranches.child!]?.headId).toBe(two)
    expect(prepared.pendingMerges.child).not.toHaveProperty('prompt')

    repository.syncSession('child', [turn(1), turn(2), turn(3, 30)])

    const state = repository.getSnapshot()
    const mergedId = state.sessionTurnRefs.child![3]!
    const merged = state.nodes[mergedId]!
    expect(state.sessionTurnRefs.child![1]).toBe(one)
    expect(state.sessionTurnRefs.child![2]).toBe(two)
    expect(merged.parentIds).toEqual([one, two])
    expect(merged.primaryParentId).toBe(two)
    expect(merged.contextManifest).toEqual([two, one])
    expect(merged.prompt).toBe('q3')
    expect(state.pendingMerges.child).toBeUndefined()
  })

  it('ignores a deprecated pending prompt when the merged Session sends its first new turn', async () => {
    const seeded = new GraphRepository()
    seeded.syncSession('source', [turn(1)])
    const one = seeded.getSnapshot().sessionTurnRefs.source![1]!
    seeded.prepareMergedSession({
      childSessionId: 'child',
      importedNodeIds: [one],
      parentIds: [one],
      primaryParentId: one,
      contextManifest: [one],
    })
    const prepared = seeded.getSnapshot()
    const legacy = {
      ...prepared,
      pendingMerges: {
        ...prepared.pendingMerges,
        child: { ...prepared.pendingMerges.child!, prompt: 'legacy question' },
      },
    }
    const repository = new GraphRepository(new MemoryTransport({ 'workspace:one': legacy }), 'workspace:one')
    await repository.hydrate()

    repository.syncSession('child', [turn(1), { ...turn(2), prompt: 'real official prompt' }])

    const state = repository.getSnapshot()
    expect(state.nodes[state.sessionTurnRefs.child![2]!]!.prompt).toBe('real official prompt')
    expect(state.pendingMerges.child).toBeUndefined()
  })

  it('collapses an official fork prefix into PA2 fork and repairs its existing child edge', () => {
    const repository = new GraphRepository()
    repository.syncSession('source', [turn(1), turn(2), { ...turn(3, 50), prompt: 'q78', answer: 'a78' }])
    repository.syncSession('child', [turn(1), turn(2), { ...turn(3, 40), prompt: 'q56', answer: 'a56' }])

    repository.reconcileOfficialForks({ child: 'source' })

    const state = repository.getSnapshot()
    const sourceOne = state.sessionTurnRefs.source![1]!
    const sourceTwo = state.sessionTurnRefs.source![2]!
    const forkOne = state.sessionTurnRefs.child![1]!
    const forkTip = state.sessionTurnRefs.child![2]!
    const forkNext = state.sessionTurnRefs.child![3]!
    expect(forkOne).toBe(sourceOne)
    expect(state.nodes[forkTip]?.forkSourceId).toBe(sourceTwo)
    expect(state.nodes[forkTip]?.primaryParentId).toBe(sourceOne)
    expect(state.nodes[forkNext]?.parentIds).toEqual([forkTip])
    const labels = nodeLabelMap(state)
    expect(labels.get(forkTip)).toBe('PA2 fork')
    expect(labels.get(forkNext)).toBe('PA3')
    expect(Object.values(state.nodes).filter(node => node.prompt === 'q1')).toHaveLength(1)
    expect(Object.values(state.nodes).filter(node => node.prompt === 'q2')).toHaveLength(2)
  })

  it('persists a branch rename', () => {
    const repository = new GraphRepository()
    repository.syncSession('s1', [turn(1)])
    const branchId = repository.getSnapshot().sessionBranches.s1!
    repository.renameBranch(branchId, 'research-line')
    expect(repository.getSnapshot().branches[branchId]?.name).toBe('research-line')
  })
})
