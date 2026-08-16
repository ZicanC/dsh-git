// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { ComposerDiscardAction } from '../src/client/ComposerDiscardAction.tsx'
import type { ContextTrayProps } from '../src/client/ContextTray.tsx'
import { ContextTrayChannel } from '../src/client/context-tray-channel.ts'
import { graph } from './fixtures.ts'

afterEach(cleanup)

function ActionHarness({ channel }: { channel: ContextTrayChannel }) {
  const useTray: SnapshotSelectorHook<ContextTrayProps | null> = selector =>
    useSyncExternalStore(
      channel.subscribe,
      () => selector(channel.getSnapshot()),
      () => selector(channel.getSnapshot()),
    )
  return <ComposerDiscardAction {...({ useTray } as never)} />
}

function model(overrides: Partial<ContextTrayProps> = {}): ContextTrayProps {
  return {
    state: graph([]),
    selectedIds: [],
    orderedIds: [],
    candidateId: null,
    busy: false,
    error: null,
    dirty: false,
    draftHasContent: false,
    overLimit: false,
    onMove: () => {},
    onMoveEnd: () => {},
    onRemove: () => {},
    onMerge: async () => {},
    onDiscard: () => {},
    ...overrides,
  }
}

describe('ComposerDiscardAction', () => {
  it('stays out of the composer row until the Context is dirty', () => {
    const channel = new ContextTrayChannel()
    render(<ActionHarness channel={channel} />)
    expect(screen.queryByRole('button')).toBeNull()

    act(() => { channel.publish({}, model()) })
    expect(screen.queryByRole('button')).toBeNull()

    act(() => { channel.publish({}, model({ dirty: true })) })
    expect(screen.getByRole('button', { name: '放弃更改并发送' })).toBeTruthy()
  })

  it('sends the source draft only when it has content, and locks while busy', () => {
    const channel = new ContextTrayChannel()
    const onDiscard = vi.fn()
    render(<ActionHarness channel={channel} />)

    act(() => { channel.publish({}, model({ dirty: true, onDiscard })) })
    fireEvent.click(screen.getByRole('button', { name: '放弃更改并发送' }))
    expect(onDiscard).toHaveBeenCalledWith(false)

    act(() => { channel.publish({}, model({ dirty: true, draftHasContent: true, onDiscard })) })
    fireEvent.click(screen.getByRole('button', { name: '放弃更改并发送' }))
    expect(onDiscard).toHaveBeenLastCalledWith(true)

    act(() => { channel.publish({}, model({ dirty: true, busy: true, onDiscard })) })
    expect((screen.getByRole('button', { name: '放弃更改并发送' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
