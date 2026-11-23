import { describe, expect, it, vi } from 'vitest'
import { hostCoordinates, selectedNodes } from '../src/client/graph.ts'
import { HostRefusal, hostRpc, rewordRefusal } from '../src/client/host-rpc.ts'
import { CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT, PROJECT_GRAPH_RPC_ENDPOINT } from '../src/protocol.ts'
import { graph, node } from './fixtures.ts'

describe('Host RPC from the browser', () => {
  it('sends each operation to its endpoint and decodes the reply', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { workspaceId: 'w', sessions: [] } }))
    const signal = new AbortController().signal

    await expect(hostRpc({ rpc: { call } } as never).readProjectGraph('w', signal))
      .resolves.toEqual({ workspaceId: 'w', sessions: [] })
    expect(call).toHaveBeenCalledWith('/dsh-git', PROJECT_GRAPH_RPC_ENDPOINT, { workspaceId: 'w' }, signal)
  })

  it('rejects with the Host\'s wording when the Host refuses, and lets the caller re-word only that', async () => {
    const refuse = vi.fn(async () => ({ ok: false as const, error: { message: 'no such Workspace' } }))
    const rpc = hostRpc({ rpc: { call: refuse } } as never)
    const request = { sourceSessionId: 's', title: 't', sources: [] }
    const signal = new AbortController().signal

    await expect(rpc.createAnchorWorkspace(request, signal)).rejects.toBeInstanceOf(HostRefusal)
    await expect(rpc.createAnchorWorkspace(request, signal)
      .catch(rewordRefusal(message => `could not anchor: ${message}`)))
      .rejects.toThrow('could not anchor: no such Workspace')
    expect(refuse).toHaveBeenCalledWith('/dsh-git', CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT, request, signal)

    // A reply of the wrong shape is not the Host refusing; it is not re-worded.
    const malformed = hostRpc({ rpc: { call: async () => ({ ok: true as const, value: {} }) } } as never)
    await expect(malformed.createAnchorWorkspace(request, signal)
      .catch(rewordRefusal(message => `could not anchor: ${message}`)))
      .rejects.not.toThrow(/could not anchor/)
  })
})

describe('a selection as the Host addresses it', () => {
  const state = graph([
    node({ id: 'a', sessionId: 'one', turn: 2, boundarySeq: 11 }),
    node({ id: 'b', sessionId: 'two', turn: 1, boundarySeq: 5 }),
  ])

  it('addresses a PA by its Session, turn, and closing boundary', () => {
    expect(hostCoordinates(state.nodes.a!)).toEqual({
      sourceSessionId: 'one', sourceTurn: 2, sourceBoundarySeq: 11,
    })
  })

  it('yields the selected PAs in order, or nothing when the selection is empty or stale', () => {
    expect(selectedNodes(state, ['b', 'a'])?.map(item => item.id)).toEqual(['b', 'a'])
    expect(selectedNodes(state, [])).toBeUndefined()
    expect(selectedNodes(state, ['a', 'gone'])).toBeUndefined()
  })
})
