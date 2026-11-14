// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { ComposerDiscardActionInjected } from '../src/client/ComposerDiscardAction.tsx'
import type { GraphViewInjected } from '../src/client/GraphView.tsx'
import {
  CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT,
  CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT,
  CREATE_ANCHORED_SESSION_RPC_ENDPOINT,
} from '../src/protocol.ts'

/** A browser whose main view shows `source`, with one completed turn anchored. */
async function anchoredFixture(options: { attachmentIds?: readonly string[] } = {}) {
    const registrations: Array<{ options: Record<string, unknown> }> = []
    const slots = {
      inject: vi.fn((_name: string, install: () => unknown) => install()),
      register: vi.fn((options: Record<string, unknown>) => {
        registrations.push({ options })
        return () => {}
      }),
    }
    const sourceCtx = { id: 'source-ctx' }
    const childCtx = { id: 'child-ctx' }
    const session = { getSnapshot: () => ({ subagent: null }) }
    const bindings = new Map<string, { sessionId: string; ctx: object; session: typeof session }>([
      ['source', { sessionId: 'source', ctx: sourceCtx, session }],
    ])
    const sourceDraft = {
      draft: 'parallel question', draftRev: 7, phase: 'plain',
      attachmentIds: [...(options.attachmentIds ?? [])], occurrences: [],
    }
    const sourceInput = {
      state: { getSnapshot: () => sourceDraft },
      setDraft: vi.fn(), addAttachments: vi.fn(() => true), removeAttachment: vi.fn(() => true),
      submit: vi.fn(), notify: vi.fn(),
    }
    // The child composer freezes while the Host admits the question. An
    // accepted question empties it; a refused one comes back for editing.
    let child = { phase: 'plain', draft: '', attachmentIds: [] as string[] }
    const childListeners = new Set<() => void>()
    const settleChildSubmission = (accepted: boolean): void => {
      child = accepted ? { phase: 'plain', draft: '', attachmentIds: [] } : { ...child, phase: 'plain' }
      for (const listener of childListeners) listener()
    }
    const childInput = {
      state: {
        getSnapshot: () => child,
        subscribe: (listener: () => void) => {
          childListeners.add(listener)
          return () => { childListeners.delete(listener) }
        },
      },
      setDraft: vi.fn((draft: string) => { child = { ...child, draft } }),
      addAttachments: vi.fn((ids: readonly string[]) => {
        child = { ...child, attachmentIds: [...child.attachmentIds, ...ids] }
        return true
      }),
      removeAttachment: vi.fn((id: string) => {
        child = { ...child, attachmentIds: child.attachmentIds.filter(candidate => candidate !== id) }
        return true
      }),
      submit: vi.fn(() => { child = { ...child, phase: 'sending' } }), notify: vi.fn(),
    }
    const restaged: string[] = []
    const open = vi.fn()
    const release = vi.fn()
    const retain = vi.fn((sessionId: string, _options: { source: string }) => {
      const binding = bindings.get(String(sessionId))
      return {
        sessionId,
        binding,
        ready: binding === undefined
          ? Promise.reject(new Error(`unknown session ${sessionId}`))
          : Promise.resolve(binding),
        release,
      }
    })
    let workspaceItems = [{
      workspaceId: 'project', title: 'Project', path: '/project', sessionIds: ['source'],
    }]
    const sessions = {
      list: {
        getSnapshot: () => ({
          ids: ['source'],
          byId: { source: { id: 'source', displayTitle: 'Source Chat' } },
        }),
      },
      // Only the Session on screen is retained by the main view.
      binding: (sessionId: string) => String(sessionId) === 'source' ? bindings.get('source') : undefined,
      retain,
    }
    const createDirectory = vi.fn(() => { throw new Error('directory picker must not be used') })
    const createWorkspace = vi.fn(() => { throw new Error('browser must not register the Workspace') })
    const rename = vi.fn(() => { throw new Error('browser must not rename the Workspace') })
    const rpcCall = vi.fn(async (_channel: string, endpoint: string, payload: Record<string, unknown>) => {
      if (endpoint === 'graph/read') {
        return { ok: true, value: { scopeId: payload.scopeId, state: null } }
      }
      if (endpoint === 'graph/write') return { ok: true, value: { scopeId: payload.scopeId } }
      if (endpoint === CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT) {
        return { ok: true, value: {
          workspaceId: 'anchor-workspace',
          workspacePath: '/project/dsh-git-anchors-test',
          workspaceTitle: '锚点问题 · Project',
        } }
      }
      if (endpoint === CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT) return { ok: true, value: { removed: false } }
      if (endpoint === CREATE_ANCHORED_SESSION_RPC_ENDPOINT) {
        const targetSessionId = String(payload.targetSessionId)
        bindings.set(targetSessionId, { sessionId: targetSessionId, ctx: childCtx, session })
        workspaceItems = [...workspaceItems, {
          workspaceId: 'anchor-workspace', title: '锚点问题 · Project',
          path: '/project/dsh-git-anchors-test', sessionIds: [targetSessionId],
        }]
        return { ok: true, value: { targetSessionId } }
      }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })
    const ctx = {
      slots,
      effect: vi.fn(),
      sessions,
      workspaces: {
        list: { getSnapshot: () => ({
          phase: 'ready',
          items: workspaceItems,
        }) },
        createDirectory,
        create: createWorkspace,
        rename,
      },
      connection: { rpc: { call: rpcCall } },
      uiWorkspace: { openSession: open },
      locale: {},
      conversation: {
        blocks: {},
        input: { for: (bindingCtx: object) => bindingCtx === sourceCtx ? sourceInput : childInput },
        rebindDraftFiles: (sessionId: string) => {
          restaged.push(sessionId.startsWith('dsh-git-anchor-') ? 'child' : sessionId)
        },
        fileUploads: { getSnapshot: () => ({}), subscribe: () => () => {} },
      },
    } as unknown as Context

    apply(ctx)
    const viewRegistration = registrations.find(entry => entry.options.name === 'conversation.view')!
    const discardRegistration = registrations.find(entry => entry.options.name === 'conversation.input.right')!
    const view = (viewRegistration.options.inject as (sessionId: string) => GraphViewInjected)('source')
    await vi.waitFor(() => expect(view.hooks.graph.ready).toBe(true))
    view.syncTurns([{
      turn: 1, prompt: 'fixed prompt', answer: 'fixed answer', createdAt: 1, boundarySeq: 6,
    }])
    const nodeId = view.hooks.graph.getSnapshot().sessionTurnRefs.source![1]!
    await view.activateAnchor([nodeId], new AbortController().signal)
    const discard = (discardRegistration.options.inject as (
      sessionId: string,
    ) => ComposerDiscardActionInjected)('source')
    return {
      view, viewRegistration, discard, nodeId, rpcCall, sourceInput, childInput, settleChildSubmission,
      retain, release, open, createDirectory, createWorkspace, rename, restaged,
    }
}

describe('anchor client flow', () => {
  it('creates a real Anchor Workspace and dispatches without opening or extending the source Chat', async () => {
    const {
      view, viewRegistration, discard, nodeId, rpcCall, sourceInput, childInput, settleChildSubmission,
      retain, release, open, createDirectory, createWorkspace, rename,
    } = await anchoredFixture()

    expect(createDirectory).not.toHaveBeenCalled()
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
    expect(rpcCall).toHaveBeenCalledWith(
      '/dsh-git',
      CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT,
      {
        sourceSessionId: 'source',
        title: '锚点问题 · Project',
        sources: [{ sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 6 }],
      },
      expect.any(AbortSignal),
    )
    expect(view.hooks.graph.getSnapshot().anchors.source?.nodeIds).toEqual([nodeId])
    discard.dispatchAnchoredDraft()
    await vi.waitFor(() => expect(childInput.submit).toHaveBeenCalledTimes(1))

    expect(childInput.setDraft).toHaveBeenCalledWith('parallel question')
    expect(open).not.toHaveBeenCalled()
    // The child is never shown, so the plugin's own reference keeps its composer
    // alive until the Host has taken the question — and until then the source
    // composer still holds the only other copy of it.
    expect(retain).toHaveBeenCalledWith(expect.stringMatching(/^dsh-git-anchor-/), expect.objectContaining({ source: 'dshGit' }))
    expect(release).not.toHaveBeenCalled()
    expect(sourceInput.setDraft).not.toHaveBeenCalled()
    settleChildSubmission(true)
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(sourceInput.setDraft).toHaveBeenCalledWith('')
    expect(sourceInput.notify).toHaveBeenCalledWith('info', expect.stringContaining('锚点问题 · Project'))
    const anchoredCall = rpcCall.mock.calls.find(([, endpoint]) => endpoint === CREATE_ANCHORED_SESSION_RPC_ENDPOINT)
    expect(anchoredCall?.[2]).toMatchObject({
      workspaceId: 'anchor-workspace',
      sources: [{
        sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 6, sourceLabel: 'PA1',
      }],
    })
    expect(String((anchoredCall?.[2] as Record<string, unknown>).targetSessionId))
      .toMatch(/^dsh-git-anchor-/)
    const childSessionId = String((anchoredCall?.[2] as Record<string, unknown>).targetSessionId)
    const childView = (viewRegistration.options.inject as (
      sessionId: string,
    ) => GraphViewInjected)(childSessionId)
    await vi.waitFor(() => expect(childView.hooks.graph.ready).toBe(true))
    childView.syncTurns([{
      turn: 2, prompt: 'parallel question', answer: 'isolated answer',
      createdAt: 2, boundarySeq: 12,
    }])
    expect(childView.hooks.graph).not.toBe(view.hooks.graph)
    expect(childView.hooks.graph.getSnapshot().sessionTurnRefs[childSessionId]?.[2]).toBeDefined()
    expect(view.hooks.graph.getSnapshot().sessionTurnRefs[childSessionId]).toBeUndefined()
    await view.cancelAnchor(new AbortController().signal)
    expect(rpcCall).toHaveBeenCalledWith(
      '/dsh-git',
      CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT,
      {
        sourceSessionId: 'source',
        workspaceId: 'anchor-workspace',
        sources: [{ sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 6 }],
      },
      expect.any(AbortSignal),
    )
    expect(view.hooks.graph.getSnapshot().anchors.source).toBeUndefined()

    await view.activateAnchor([nodeId], new AbortController().signal)
    expect(view.hooks.graph.getSnapshot().anchors.source).toMatchObject({
      workspaceId: 'anchor-workspace',
      workspacePath: '/project/dsh-git-anchors-test',
      nodeIds: [nodeId],
    })
    expect(rpcCall.mock.calls.filter(([, endpoint]) =>
      endpoint === CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT)).toHaveLength(2)
  })

  it('keeps the question and its attachments in the source composer when the child Session refuses it', async () => {
    const {
      discard, sourceInput, childInput, settleChildSubmission, release, restaged,
    } = await anchoredFixture({ attachmentIds: ['file-1'] })

    discard.dispatchAnchoredDraft()
    await vi.waitFor(() => expect(childInput.submit).toHaveBeenCalledTimes(1))
    expect(restaged).toEqual(['child'])
    settleChildSubmission(false)
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))

    // Nothing was taken from the source, and what the child held went back.
    expect(sourceInput.setDraft).not.toHaveBeenCalled()
    expect(sourceInput.removeAttachment).not.toHaveBeenCalled()
    expect(childInput.removeAttachment).toHaveBeenCalledWith('file-1')
    expect(restaged).toEqual(['child', 'source'])
    expect(sourceInput.notify).toHaveBeenCalledWith('error', expect.stringMatching(/未接受|did not accept/))
    expect(sourceInput.notify).not.toHaveBeenCalledWith('info', expect.anything())
  })

  it('does not dispatch the same question twice while the first is still being admitted', async () => {
    const { discard, childInput, settleChildSubmission, rpcCall, release } = await anchoredFixture()

    discard.dispatchAnchoredDraft()
    await vi.waitFor(() => expect(childInput.submit).toHaveBeenCalledTimes(1))
    discard.dispatchAnchoredDraft()
    settleChildSubmission(true)
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))

    expect(rpcCall.mock.calls.filter(([, endpoint]) =>
      endpoint === CREATE_ANCHORED_SESSION_RPC_ENDPOINT)).toHaveLength(1)
  })
})
