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
    onSendRefused: () => {},
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

  it('guards the surrounding composer card while the Context is unmerged', () => {
    const channel = new ContextTrayChannel()
    const onSendRefused = vi.fn()
    // The action seats inside the official composer card; the guard finds it there.
    const card = document.createElement('div')
    card.dataset['composerCard'] = ''
    const textarea = document.createElement('textarea')
    card.appendChild(textarea)
    document.body.appendChild(card)
    const mount = document.createElement('div')
    card.appendChild(mount)
    render(<ActionHarness channel={channel} />, { container: mount })

    const pressEnter = () => textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    act(() => { channel.publish({}, model({ onSendRefused })) })
    expect(pressEnter()).toBe(true)

    act(() => { channel.publish({}, model({ dirty: true, onSendRefused })) })
    expect(pressEnter()).toBe(false)
    expect(onSendRefused).toHaveBeenCalledTimes(1)

    // A Merge in flight keeps the guard up even though the button is hidden.
    act(() => { channel.publish({}, model({ busy: true, onSendRefused })) })
    expect(screen.queryByRole('button')).toBeNull()
    expect(pressEnter()).toBe(false)

    act(() => { channel.clear({}) })
    card.remove()
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
