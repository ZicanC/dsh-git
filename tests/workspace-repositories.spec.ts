import { describe, expect, it } from 'vitest'
import { GraphRepository } from '../src/client/repository.ts'
import { WorkspaceGraphRepositories } from '../src/client/workspace-repositories.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

function workspaces(items: readonly { workspaceId: string; sessionIds: readonly string[] }[]) {
  return { list: { getSnapshot: () => ({ items }) } } as never
}

const turn = { turn: 1, prompt: 'q', answer: 'a', createdAt: 1, boundarySeq: 2 }

describe('WorkspaceGraphRepositories', () => {
  it('keeps branch state isolated between Workspace folders', () => {
    const storage = new MemoryStorage()
    const repositories = new WorkspaceGraphRepositories(workspaces([
      { workspaceId: 'one', sessionIds: ['s1'] },
      { workspaceId: 'two', sessionIds: ['s2'] },
    ]), storage)

    repositories.forSession('s1').syncSession('s1', [turn])
    expect(Object.keys(repositories.forWorkspace('one').getSnapshot().nodes)).toHaveLength(1)
    expect(Object.keys(repositories.forSession('s2').getSnapshot().nodes)).toHaveLength(0)
    expect(storage.values.size).toBe(2)
  })

  it('partitions the legacy global ledger on first use without cross-folder edges', () => {
    const storage = new MemoryStorage()
    const legacy = new GraphRepository(storage)
    legacy.syncSession('s1', [turn])
    legacy.syncSession('s2', [turn])
    const repositories = new WorkspaceGraphRepositories(workspaces([
      { workspaceId: 'one', sessionIds: ['s1'] },
      { workspaceId: 'two', sessionIds: ['s2'] },
    ]), storage)

    expect(Object.keys(repositories.forWorkspace('one').getSnapshot().nodes)).toHaveLength(1)
    expect(Object.keys(repositories.forWorkspace('two').getSnapshot().nodes)).toHaveLength(1)
    expect(storage.values.size).toBe(3)
  })

  it('pins a new merge Session to its source folder before membership refreshes', () => {
    const repositories = new WorkspaceGraphRepositories(workspaces([
      { workspaceId: 'one', sessionIds: ['source'] },
    ]))
    const source = repositories.forSession('source')
    repositories.pinSession('child', source)
    expect(repositories.forSession('child')).toBe(source)
  })

  it('uses a private ledger for a Session outside every folder', () => {
    const repositories = new WorkspaceGraphRepositories(workspaces([]))
    repositories.forSession('loose-a').syncSession('loose-a', [turn])
    expect(Object.keys(repositories.forSession('loose-b').getSnapshot().nodes)).toHaveLength(0)
  })
})
