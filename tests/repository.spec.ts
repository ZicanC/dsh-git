import { describe, expect, it } from 'vitest'
import { GraphRepository } from '../src/client/repository.ts'

class MemoryStorage {
  value: string | null = null
  getItem(): string | null { return this.value }
  setItem(_key: string, value: string): void { this.value = value }
}

const turn = (number: number, createdAt = number * 10) => ({
  turn: number,
  prompt: `q${number}`,
  answer: `a${number}`,
  createdAt,
  boundarySeq: number * 5,
})

describe('GraphRepository', () => {
  it('imports a linear session and seeds the tray with the primary path', () => {
    const storage = new MemoryStorage()
    const repository = new GraphRepository(storage)
    repository.syncSession('s1', [turn(1), turn(2)])

    const state = repository.getSnapshot()
    const first = state.nodes[state.sessionTurnRefs.s1![1]!]!
    const second = state.nodes[state.sessionTurnRefs.s1![2]!]!
    expect(first.parentIds).toEqual([])
    expect(second.parentIds).toEqual([first.id])
    expect(second.contextManifest).toEqual([first.id])
    expect(state.contextManifest).toEqual([first.id, second.id])
    expect(storage.value).toContain('sessionTurnRefs')
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

  it('creates a multi-parent merge node on the child session', () => {
    const repository = new GraphRepository()
    repository.syncSession('source', [turn(1), turn(2)])
    const before = repository.getSnapshot()
    const one = before.sessionTurnRefs.source![1]!
    const two = before.sessionTurnRefs.source![2]!
    repository.prepareBranch({
      sourceSessionId: 'source',
      childSessionId: 'child',
      baseNodeId: one,
      importedNodeIds: [one, two],
      parentIds: [one, two],
      primaryParentId: two,
      contextManifest: [two, one],
      prompt: 'merged question',
    })
    repository.syncSession('child', [turn(1), turn(2), turn(3, 30)])

    const state = repository.getSnapshot()
    const mergedId = state.sessionTurnRefs.child![3]!
    const merged = state.nodes[mergedId]!
    expect(state.sessionTurnRefs.child![1]).toBe(one)
    expect(state.sessionTurnRefs.child![2]).toBe(two)
    expect(merged.parentIds).toEqual([one, two])
    expect(merged.primaryParentId).toBe(two)
    expect(merged.contextManifest).toEqual([two, one])
    expect(merged.prompt).toBe('merged question')
    expect(state.pendingMerges.child).toBeUndefined()
  })

  it('persists a branch rename', () => {
    const repository = new GraphRepository()
    repository.syncSession('s1', [turn(1)])
    const branchId = repository.getSnapshot().sessionBranches.s1!
    repository.renameBranch(branchId, 'research-line')
    expect(repository.getSnapshot().branches[branchId]?.name).toBe('research-line')
  })
})
