import { describe, expect, it, vi } from 'vitest'
import { draftAttachmentStaging } from '../src/client/draft-attachments.ts'

type Upload = { status: 'uploading' | 'ready' | 'error'; message?: string }

function conversation(initial: Record<string, Upload> = {}) {
  let uploads = initial
  const listeners = new Set<() => void>()
  return {
    rebindDraftFiles: vi.fn(),
    fileUploads: {
      getSnapshot: () => uploads,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    publish: (next: Record<string, Upload>) => {
      uploads = next
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

const ids = (...values: string[]) => values as never

describe('draft attachment staging', () => {
  it('is unavailable when the Conversation service does not expose the staging members', () => {
    expect(draftAttachmentStaging(undefined)).toBeUndefined()
    expect(draftAttachmentStaging({ input: {}, blocks: {} })).toBeUndefined()
    expect(draftAttachmentStaging({ rebindDraftFiles: vi.fn() })).toBeUndefined()
    expect(draftAttachmentStaging({ fileUploads: conversation().fileUploads })).toBeUndefined()
  })

  it('stages the uploads again for the receiving Session', () => {
    const service = conversation()
    draftAttachmentStaging(service)!.restage('child' as never, ids('a', 'b'), true)
    expect(service.rebindDraftFiles).toHaveBeenCalledWith('child', ['a', 'b'], true)
  })

  it('treats a ready upload and an inline draft without one as sendable', async () => {
    const service = conversation({ a: { status: 'ready' } })
    await expect(draftAttachmentStaging(service)!.whenReady(ids('a', 'inline'), new AbortController().signal))
      .resolves.toBeUndefined()
    expect(service.listenerCount()).toBe(0)
  })

  it('waits for every upload and stops listening once they are ready', async () => {
    const service = conversation({ a: { status: 'uploading' }, b: { status: 'uploading' } })
    let ready = false
    const waiting = draftAttachmentStaging(service)!.whenReady(ids('a', 'b'), new AbortController().signal)
      .then(() => { ready = true })
    service.publish({ a: { status: 'ready' }, b: { status: 'uploading' } })
    await Promise.resolve()
    expect(ready).toBe(false)
    service.publish({ a: { status: 'ready' }, b: { status: 'ready' } })
    await waiting
    expect(ready).toBe(true)
    expect(service.listenerCount()).toBe(0)
  })

  it('rejects with the upload failure and with the abort reason', async () => {
    const failing = conversation({ a: { status: 'uploading' } })
    const failed = draftAttachmentStaging(failing)!.whenReady(ids('a'), new AbortController().signal)
    failing.publish({ a: { status: 'error', message: 'too large' } })
    await expect(failed).rejects.toThrow('too large')
    expect(failing.listenerCount()).toBe(0)

    const pending = conversation({ a: { status: 'uploading' } })
    const controller = new AbortController()
    const aborted = draftAttachmentStaging(pending)!.whenReady(ids('a'), controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(aborted).rejects.toThrow('cancelled')
    expect(pending.listenerCount()).toBe(0)
  })
})
