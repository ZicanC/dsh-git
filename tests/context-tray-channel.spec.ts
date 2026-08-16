import { describe, expect, it, vi } from 'vitest'
import type { ContextTrayProps } from '../src/client/ContextTray.tsx'
import {
  ContextTrayChannel, ContextTrayChannels,
} from '../src/client/context-tray-channel.ts'
import { graph } from './fixtures.ts'

function model(label: string): ContextTrayProps {
  return {
    state: graph([]),
    selectedIds: [],
    orderedIds: [],
    candidateId: null,
    busy: false,
    error: label,
    dirty: false,
    draftHasContent: false,
    overLimit: false,
    onMove: () => {},
    onMoveEnd: () => {},
    onRemove: () => {},
    onMerge: async () => {},
    onDiscard: () => {},
  }
}

describe('ContextTrayChannel', () => {
  it('publishes stable snapshots and stops notifying after unsubscribe', () => {
    const channel = new ContextTrayChannel()
    const owner = {}
    const first = model('first')
    const second = model('second')
    const listener = vi.fn()
    const unsubscribe = channel.subscribe(listener)

    expect(channel.getSnapshot()).toBeNull()
    channel.publish(owner, first)
    expect(channel.getSnapshot()).toBe(first)
    expect(listener).toHaveBeenCalledTimes(1)

    channel.publish(owner, first)
    expect(listener).toHaveBeenCalledTimes(1)
    channel.publish(owner, second)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    channel.clear(owner)
    expect(channel.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale cleanup after a newer owner publishes', () => {
    const channel = new ContextTrayChannel()
    const oldOwner = {}
    const newOwner = {}
    const oldModel = model('old')
    const newModel = model('new')

    channel.publish(oldOwner, oldModel)
    channel.publish(newOwner, newModel)
    channel.clear(oldOwner)
    expect(channel.getSnapshot()).toBe(newModel)

    channel.clear(newOwner)
    expect(channel.getSnapshot()).toBeNull()
  })

  it('returns one stable channel per Session and isolates different Sessions', () => {
    const channels = new ContextTrayChannels()
    const sessionA = channels.forSession('session-a')
    const sessionB = channels.forSession('session-b')

    expect(channels.forSession('session-a')).toBe(sessionA)
    expect(sessionB).not.toBe(sessionA)

    sessionA.publish({}, model('session-a'))
    expect(sessionA.getSnapshot()?.error).toBe('session-a')
    expect(sessionB.getSnapshot()).toBeNull()
  })
})
