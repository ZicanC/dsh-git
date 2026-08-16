import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import { ComposerBlockLease } from '../src/client/composer-block-lease.ts'

function blockRegistry() {
  let value: { reason: string } | undefined
  const listeners = new Set<() => void>()
  return {
    registry: {
      set: vi.fn((_id: SessionId, block: { reason: string } | undefined) => {
        if (value?.reason === block?.reason) return
        value = block
        for (const listener of listeners) listener()
      }),
      storeFor: (_id: SessionId) => ({
        getSnapshot: () => value,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: (next: { reason: string } | undefined) => { value = next },
        update: (_mutator: (draft: { reason: string } | undefined) => void) => {},
      }),
      forget: (_id: SessionId) => {},
    },
    current: () => value,
    listenerCount: () => listeners.size,
  }
}

describe('ComposerBlockLease', () => {
  const sessionId = 'session-a' as SessionId

  it('raises and releases only its own block', () => {
    const fixture = blockRegistry()
    const lease = new ComposerBlockLease(fixture.registry, sessionId, () => 'merge or discard')

    lease.setBlocked(true)
    expect(fixture.current()).toEqual({ reason: 'merge or discard' })
    expect(fixture.listenerCount()).toBe(1)

    expect(lease.setBlocked(false)).toBe(true)
    expect(fixture.current()).toBeUndefined()
    expect(fixture.listenerCount()).toBe(0)
  })

  it('preserves a foreign block and takes over only after that owner releases it', () => {
    const fixture = blockRegistry()
    const foreign = { reason: 'choose a routable model' }
    fixture.registry.set(sessionId, foreign)
    const lease = new ComposerBlockLease(fixture.registry, sessionId, () => 'merge or discard')

    lease.setBlocked(true)
    expect(fixture.current()).toBe(foreign)

    fixture.registry.set(sessionId, undefined)
    expect(fixture.current()).toEqual({ reason: 'merge or discard' })

    const replacement = { reason: 'workspace unavailable' }
    fixture.registry.set(sessionId, replacement)
    expect(lease.setBlocked(false)).toBe(false)
    expect(fixture.current()).toBe(replacement)
  })
})
