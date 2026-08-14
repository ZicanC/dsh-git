// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectGraphPage } from '../src/client/ProjectGraphPage.tsx'
import { graph } from './fixtures.ts'
import type { ProjectGraphResponse } from '../src/protocol.ts'

afterEach(cleanup)

class ProjectResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ProjectResizeObserver)

const response: ProjectGraphResponse = {
  workspaceId: 'w',
  sessions: [{
    sessionId: 's', createdAt: 1, seedLength: 0,
    turns: [
      { turn: 1, prompt: 'First prompt', answer: 'First answer', startedAt: 10, completedAt: 20, boundarySeq: 3, inherited: false, fingerprint: 'one' },
      { turn: 2, prompt: 'Second prompt', answer: 'Second answer', startedAt: 30, completedAt: 40, boundarySeq: 7, inherited: false, fingerprint: 'two' },
    ],
  }],
}

describe('project graph page', () => {
  it('opens on the full graph and scrubs back to the root PA', async () => {
    render(<ProjectGraphPage
      workspaceId="w" workspaceTitle="Project" sessionTitles={{ s: 'Session one' }}
      load={async () => response} getLocalState={() => graph([])}
      onClose={vi.fn()} onOpenSession={vi.fn()}
    />)
    const slider = await screen.findByRole('slider', { name: 'PA 时间轴游标' }) as HTMLInputElement
    expect(slider.value).toBe('2')
    expect(screen.getByRole('button', { name: '查看 PA2 context' })).toBeTruthy()
    fireEvent.change(slider, { target: { value: '1' } })
    expect(screen.getByRole('button', { name: '查看 PA1 context' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '查看 PA2 context' })).toBeNull()
  })

  it('shows PA details and opens the source Session', async () => {
    const open = vi.fn()
    render(<ProjectGraphPage
      workspaceId="w" workspaceTitle="Project" sessionTitles={{ s: 'Session one' }}
      load={async () => response} getLocalState={() => graph([])}
      onClose={vi.fn()} onOpenSession={open}
    />)
    fireEvent.click(await screen.findByRole('button', { name: '查看 PA2 context' }))
    expect(screen.getByLabelText('项目 PA 详情')).toBeTruthy()
    expect(screen.getAllByText('Session one').length).toBeGreaterThan(0)
    expect(screen.getByText('Second answer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打开原会话' }))
    expect(open).toHaveBeenCalledWith('s')
  })

  it('surfaces a load error and retries', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(response)
    render(<ProjectGraphPage
      workspaceId="w" workspaceTitle="Project" sessionTitles={{}}
      load={load} getLocalState={() => graph([])} onClose={vi.fn()} onOpenSession={vi.fn()}
    />)
    expect((await screen.findByRole('alert')).textContent).toContain('read failed')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('slider')).toBeTruthy()
  })
})
