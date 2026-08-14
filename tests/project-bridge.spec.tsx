// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installProjectBridge } from '../src/client/project-bridge.tsx'
import { GraphRepository } from '../src/client/repository.ts'

afterEach(() => { document.body.innerHTML = '' })

class BridgeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', BridgeResizeObserver)

function source<T>(value: T) {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

describe('project sidebar compatibility bridge', () => {
  it('injects one button, opens the takeover, and removes all owned DOM on dispose', async () => {
    document.body.innerHTML = `
      <aside>
        <div role="treeitem" aria-expanded="true"><span>Project</span><span>
          <button class="row-button" aria-label="Workspace actions"></button>
          <button class="row-button" aria-label="New Session"></button>
        </span></div>
      </aside>
      <section id="conversation"><div data-conversation-scroll></div></section>`
    const workspaces = source({ items: [{
      workspaceId: 'w', path: '/project', title: 'Project', sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }], phase: 'ready' })
    const sessions = source({ ids: [], byId: {}, current: undefined, phase: 'ready' })
    const call = vi.fn(async () => ({ ok: true, value: { workspaceId: 'w', sessions: [] } }))
    const dispose = installProjectBridge({
      connection: { rpc: { call } } as never,
      sessions: { list: sessions, open: vi.fn() } as never,
      workspaces: { list: workspaces } as never,
      repositoryForWorkspace: () => new GraphRepository(),
    })

    const button = screen.getByRole('button', { name: '打开“Project”的 Conversation Graph' })
    expect(document.querySelectorAll('[data-dsh-git-project-button]')).toHaveLength(1)
    fireEvent.click(button)
    expect(await screen.findByRole('dialog', { name: 'Project Conversation Graph' })).toBeTruthy()
    await waitFor(() => expect(call).toHaveBeenCalledOnce())
    expect(screen.getByText('这个项目还没有已完成的 PA。')).toBeTruthy()

    await act(async () => { dispose() })
    expect(document.querySelector('[data-dsh-git-project-button]')).toBeNull()
    expect(document.querySelector('[data-dsh-git-project-host]')).toBeNull()
  })
})
