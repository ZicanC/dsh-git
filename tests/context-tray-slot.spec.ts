import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ComposerDiscardAction } from '../src/client/ComposerDiscardAction.tsx'
import { ContextTrayDock } from '../src/client/ContextTrayDock.tsx'
import { ContextTrayChannel } from '../src/client/context-tray-channel.ts'
import { apply } from '../src/client/index.ts'

describe('Context Tray slot registration', () => {
  it('uses the official Session input dock before the terminal Queue entry', async () => {
    const registrations: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const register = vi.fn((options: Record<string, unknown>, component: unknown) => {
      registrations.push({ options, component })
      return () => {}
    })
    const slots = {
      inject: vi.fn((_name: string, install: () => unknown) => install()),
      register,
    }
    const listSnapshot = { current: undefined, ids: [], byId: {} }
    const ctx = {
      slots,
      effect: vi.fn(),
      sessions: { list: { getSnapshot: () => listSnapshot } },
      workspaces: {
        list: { getSnapshot: () => ({ phase: 'ready', items: [] }) },
      },
      connection: {
        rpc: {
          call: vi.fn(async (_channel: string, endpoint: string, payload: { scopeId?: string }) => {
            if (endpoint !== 'graph/read') throw new Error(`unexpected RPC ${endpoint}`)
            return { ok: true, value: { scopeId: payload.scopeId, state: null } }
          }),
        },
      },
      locale: {},
      conversation: { blocks: {} },
    } as unknown as Context

    apply(ctx)

    expect(slots.inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    const dock = registrations.find(entry => entry.options['name'] === 'conversation.input.dock')
    expect(dock).toBeDefined()
    expect(dock?.component).toBe(ContextTrayDock)
    expect(dock?.options).toMatchObject({
      name: 'conversation.input.dock',
      id: 'dsh-git-context-tray',
      order: 15,
    })

    const view = registrations.find(entry => entry.options['name'] === 'conversation.view')
    expect(view).toBeDefined()
    const dockInject = dock?.options['inject'] as (sessionId: string) => {
      hooks: { tray: ContextTrayChannel }
    }
    const viewInject = view?.options['inject'] as (sessionId: string) => {
      tray: ContextTrayChannel
    }
    const dockFace = dockInject('session-a')
    const viewFace = viewInject('session-a')
    expect(dockFace.hooks.tray).toBe(viewFace.tray)
    expect(dockFace.hooks.tray).toBeInstanceOf(ContextTrayChannel)

    const otherDockFace = dockInject('session-b')
    expect(otherDockFace.hooks.tray).not.toBe(dockFace.hooks.tray)

    // The discard action sits in the composer tool row, on the same channel.
    expect(slots.inject).toHaveBeenCalledWith('conversation.input.right', expect.any(Function))
    const discard = registrations.find(entry => entry.options['name'] === 'conversation.input.right')
    expect(discard?.component).toBe(ComposerDiscardAction)
    expect(discard?.options).toMatchObject({
      name: 'conversation.input.right',
      id: 'dsh-git-discard-context',
      order: 10,
    })
    const discardInject = discard?.options['inject'] as (sessionId: string) => {
      hooks: { tray: ContextTrayChannel }
    }
    expect(discardInject('session-a').hooks.tray).toBe(dockFace.hooks.tray)
    await Promise.resolve()
  })
})
