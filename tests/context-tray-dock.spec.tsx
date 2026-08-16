// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { ContextTrayDock } from '../src/client/ContextTrayDock.tsx'
import type { ContextTrayProps } from '../src/client/ContextTray.tsx'
import { ContextTrayChannel } from '../src/client/context-tray-channel.ts'
import { graph, node } from './fixtures.ts'

afterEach(cleanup)

function DockHarness({ channel }: { channel: ContextTrayChannel }) {
  const useTray: SnapshotSelectorHook<ContextTrayProps | null> = selector =>
    useSyncExternalStore(
      channel.subscribe,
      () => selector(channel.getSnapshot()),
      () => selector(channel.getSnapshot()),
    )
  return <ContextTrayDock {...({ useTray } as never)} />
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

describe('ContextTrayDock', () => {
  it('renders nothing for an absent or clean empty tray model', () => {
    const channel = new ContextTrayChannel()
    const owner = {}
    render(<DockHarness channel={channel} />)
    expect(screen.queryByLabelText('Context Tray')).toBeNull()

    act(() => { channel.publish(owner, model()) })
    expect(screen.queryByLabelText('Context Tray')).toBeNull()
  })

  it('renders the published Session model and clears with its owner', () => {
    const channel = new ContextTrayChannel()
    const owner = {}
    const pa = node({ id: 'pa-dock' })
    render(<DockHarness channel={channel} />)

    act(() => {
      channel.publish(owner, model({
        state: graph([pa]),
        selectedIds: [pa.id],
        orderedIds: [pa.id],
      }))
    })
    expect(screen.getByLabelText('Context Tray')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开 Context Tray' }))
    expect(screen.getByText('PA1')).toBeTruthy()

    act(() => { channel.clear(owner) })
    expect(screen.queryByLabelText('Context Tray')).toBeNull()
  })

  it('keeps a dirty empty tray visible without repeating the composer guidance', () => {
    const channel = new ContextTrayChannel()
    render(<DockHarness channel={channel} />)
    act(() => { channel.publish({}, model({ dirty: true })) })

    expect(screen.getByLabelText('Context Tray')).toBeTruthy()
    expect(screen.queryByText(/未 Merge 的更改/)).toBeNull()
    expect(screen.queryByRole('button', { name: /放弃更改/ })).toBeNull()
  })
})
