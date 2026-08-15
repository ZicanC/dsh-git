import { describe, expect, it } from 'vitest'
import { WorkspaceGraphRepositories } from '../src/client/workspace-repositories.ts'
import { MemoryTransport } from './fixtures.ts'

function workspaces(items: readonly { workspaceId: string; sessionIds: readonly string[] }[]) {
  return { list: { getSnapshot: () => ({ items }) } } as never
}

const turn = { turn: 1, prompt: 'q', answer: 'a', createdAt: 1, boundarySeq: 2 }

/** Let the detached hydrate() started by forScope() settle. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('WorkspaceGraphRepositories', () => {
  it('keeps branch state isolated between Workspace folders', async () => {
    const transport = new MemoryTransport()
    const repositories = new WorkspaceGraphRepositories(workspaces([
      { workspaceId: 'one', sessionIds: ['s1'] },
      { workspaceId: 'two', sessionIds: ['s2'] },
    ]), transport)

    repositories.forSession('s1').syncSession('s1', [turn])
    repositories.forSession('s2')
    await settle()

    expect(Object.keys(repositories.forWorkspace('one').getSnapshot().nodes)).toHaveLength(1)
    expect(Object.keys(repositories.forSession('s2').getSnapshot().nodes)).toHaveLength(0)
    expect([...transport.scopes.keys()]).toEqual(['workspace:one'])
  })

  it('addresses each ledger by a scope id that is stable across browsers', async () => {
    const transport = new MemoryTransport()
    const repositories = new WorkspaceGraphRepositories(workspaces([
      { workspaceId: 'one', sessionIds: ['s1'] },
    ]), transport)
    repositories.forSession('s1').syncSession('s1', [turn])
    await settle()

    const revisited = new WorkspaceGraphRepositories(workspaces([
      { workspaceId: 'one', sessionIds: ['s1'] },
    ]), transport)
    const repository = revisited.forSession('s1')
    await repository.hydrate()
    expect(Object.keys(repository.getSnapshot().nodes)).toHaveLength(1)
  })

  it('pins a new merge Session to its source folder before membership refreshes', () => {
    const repositories = new WorkspaceGraphRepositories(workspaces([
      { workspaceId: 'one', sessionIds: ['source'] },
    ]))
    const source = repositories.forSession('source')
    repositories.pinSession('child', source)
    expect(repositories.forSession('child')).toBe(source)
  })

  it('uses a private ledger for a Session outside every folder', async () => {
    const transport = new MemoryTransport()
    const repositories = new WorkspaceGraphRepositories(workspaces([]), transport)
    repositories.forSession('loose-a').syncSession('loose-a', [turn])
    repositories.forSession('loose-b')
    await settle()

    expect(Object.keys(repositories.forSession('loose-b').getSnapshot().nodes)).toHaveLength(0)
    expect([...transport.scopes.keys()]).toEqual(['session:loose-a'])
  })
})
