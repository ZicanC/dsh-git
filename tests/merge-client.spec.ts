// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { GraphViewInjected } from '../src/client/GraphView.tsx'
import { CREATE_MERGED_SESSION_RPC_ENDPOINT } from '../src/protocol.ts'

afterEach(() => { document.body.innerHTML = '' })

/** A browser whose main view shows `source`; every other Session exists only while retained. */
function fixture(options: { staging: boolean; attachmentIds: readonly string[] }) {
  const log: string[] = []
  const registrations: Array<{ options: Record<string, unknown> }> = []
  const slots = {
    inject: vi.fn((_name: string, install: () => unknown) => install()),
    register: vi.fn((registration: Record<string, unknown>) => {
      registrations.push({ options: registration })
      return () => {}
    }),
  }
  const sourceCtx = { id: 'source-ctx' }
  const childCtx = { id: 'child-ctx' }
  const session = { getSnapshot: () => ({ subagent: null }) }
  const sourceBinding = { sessionId: 'source', ctx: sourceCtx, session }
  let sourceDraft = {
    draft: 'carry this', draftRev: 3, phase: 'plain',
    attachmentIds: [...options.attachmentIds], occurrences: [],
  }
  const sourceInput = {
    state: { getSnapshot: () => sourceDraft },
    setDraft: vi.fn((text: string) => {
      log.push(`source.setDraft:${text}`)
      sourceDraft = { ...sourceDraft, draft: text }
    }),
    addAttachments: vi.fn(() => true),
    removeAttachment: vi.fn((id: string) => {
      log.push(`source.removeAttachment:${id}`)
      return true
    }),
    notify: vi.fn(),
  }
  const childInput = {
    state: { getSnapshot: () => ({ phase: 'plain' }) },
    setDraft: vi.fn((text: string) => { log.push(`child.setDraft:${text}`) }),
    addAttachments: vi.fn((ids: readonly string[]) => {
      log.push(`child.addAttachments:${ids.join(',')}`)
      return true
    }),
    removeAttachment: vi.fn(() => true),
    notify: vi.fn(),
  }
  const opened = new Set<string>()
  let released = false
  const retain = vi.fn((sessionId: string, _options: { source: string }) => ({
    sessionId,
    get binding() {
      if (released) throw new Error('binding read after release')
      return { sessionId, ctx: childCtx, session }
    },
    ready: Promise.resolve(),
    release: () => {
      log.push('release')
      released = true
    },
  }))
  const rpcCall = vi.fn(async (_channel: string, endpoint: string, payload: Record<string, unknown>) => {
    if (endpoint === 'graph/read') return { ok: true, value: { scopeId: payload.scopeId, state: null } }
    if (endpoint === 'graph/write') return { ok: true, value: { scopeId: payload.scopeId } }
    if (endpoint === CREATE_MERGED_SESSION_RPC_ENDPOINT) {
      return { ok: true, value: { targetSessionId: payload.targetSessionId } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  const staging = options.staging
    ? {
        rebindDraftFiles: vi.fn((sessionId: string, ids: readonly string[], uploadImages: boolean) => {
          log.push(`restage:${sessionId.startsWith('dsh-git-') ? 'child' : sessionId}:${ids.join(',')}:${uploadImages}`)
        }),
        fileUploads: { getSnapshot: () => ({}), subscribe: () => () => {} },
      }
    : {}
  const ctx = {
    slots,
    effect: vi.fn(),
    sessions: {
      list: { getSnapshot: () => ({ ids: ['source'], byId: { source: { id: 'source', displayTitle: 'Source' } } }) },
      binding: (sessionId: string) => String(sessionId) === 'source' ? sourceBinding : undefined,
      retain,
      retainInfo: (sessionId: string) => ({
        getSnapshot: () => ({
          referenceCount: 1,
          retainedBy: { mainView: sessionId === 'source' || opened.has(sessionId) ? 1 : 0 },
        }),
      }),
    },
    workspaces: {
      list: { getSnapshot: () => ({ phase: 'ready', items: [{
        workspaceId: 'project', title: 'Project', path: '/project', sessionIds: ['source'],
      }] }) },
    },
    connection: { rpc: { call: rpcCall } },
    uiWorkspace: {
      openSession: vi.fn((sessionId: string) => {
        log.push('open')
        opened.add(sessionId)
      }),
    },
    locale: {},
    conversation: {
      blocks: {},
      input: { for: (bindingCtx: object) => bindingCtx === sourceCtx ? sourceInput : childInput },
      ...staging,
    },
  } as unknown as Context

  apply(ctx)
  const viewRegistration = registrations.find(entry => entry.options.name === 'conversation.view')!
  const view = (viewRegistration.options.inject as (sessionId: string) => GraphViewInjected)('source')
  const createFromFirstTurn = async (): Promise<void> => {
    await vi.waitFor(() => expect(view.hooks.graph.ready).toBe(true))
    view.syncTurns([{ turn: 1, prompt: 'P1', answer: 'A1', createdAt: 1, boundarySeq: 6 }])
    const nodeId = view.hooks.graph.getSnapshot().sessionTurnRefs.source![1]!
    await view.createMergedSession([nodeId], {
      text: 'carry this', draftRevision: 3,
      attachmentIds: options.attachmentIds as never, hasStructuredReferences: false,
    }, new AbortController().signal)
  }
  return { ctx, log, retain, sourceInput, childInput, createFromFirstTurn, opened }
}

describe('merged Chat creation in the browser', () => {
  it('moves the draft and its attachments, opens the new Chat, and only then lets go of it', async () => {
    // The Branches tab of the opened Chat, already selected.
    document.body.innerHTML = '<button role="tab" aria-selected="true">Branches</button>'
    const { log, retain, createFromFirstTurn, opened, childInput } = fixture({ staging: true, attachmentIds: ['image-1'] })

    await createFromFirstTurn()

    expect(retain).toHaveBeenCalledWith(expect.stringMatching(/^dsh-git-/), expect.objectContaining({ source: 'dshGit' }))
    expect(log).toEqual([
      'child.addAttachments:image-1',
      'restage:child:image-1:true',
      'child.setDraft:carry this',
      'source.setDraft:',
      'source.removeAttachment:image-1',
      'open',
      'release',
    ])
    expect([...opened]).toEqual([retain.mock.calls[0]![0]])
    expect(childInput.notify).not.toHaveBeenCalled()
  })

  it('leaves a draft with attachments where it is when this Harness cannot stage them for another Session', async () => {
    const { log, sourceInput, childInput, createFromFirstTurn, opened } = fixture({ staging: false, attachmentIds: ['image-1'] })

    await expect(createFromFirstTurn()).rejects.toThrow(/草稿附件无法转移|could not be transferred/)

    expect(childInput.addAttachments).not.toHaveBeenCalled()
    expect(childInput.setDraft).not.toHaveBeenCalled()
    expect(sourceInput.setDraft).not.toHaveBeenCalled()
    expect(sourceInput.removeAttachment).not.toHaveBeenCalled()
    expect(opened.size).toBe(0)
    // The unopened child is not kept alive.
    expect(log).toEqual(['release'])
  })

  it('moves a text-only draft without needing the staging face', async () => {
    document.body.innerHTML = '<button role="tab" aria-selected="true">Branches</button>'
    const { log, createFromFirstTurn } = fixture({ staging: false, attachmentIds: [] })

    await createFromFirstTurn()

    expect(log).toEqual(['child.setDraft:carry this', 'source.setDraft:', 'open', 'release'])
  })
})
