/**
 * Moving a draft's attachments from one Session's composer to another's.
 *
 * Harness stages a draft attachment's upload against the Session it was added
 * to, and the Host resolves an upload receipt only for that Session's Agent.
 * Handing the attachment ids to another composer is therefore not enough: the
 * uploads must be staged again for the receiving Session, or its send fails.
 *
 * Harness performs that step itself when a draft follows a Workspace switch,
 * through `rebindDraftFiles` and the `fileUploads` store on its Conversation
 * service. Neither is part of the outward `IConversation` contract, so this
 * module detects them at runtime instead of assuming them. When they are
 * missing, callers refuse to move a draft that carries attachments and leave
 * it where it is.
 */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'

type UploadState = { readonly status?: unknown; readonly message?: unknown } | undefined

interface UploadStore {
  getSnapshot(): Readonly<Record<string, UploadState>>
  subscribe(listener: () => void): () => void
}

/** Re-stages a moved draft's uploads for the Session that now owns them. */
export interface DraftAttachmentStaging {
  /**
   * Start staging the uploads again for `sessionId`.
   * @param uploadImages - whether that Session stages image uploads; an image
   *   draft otherwise sends its bytes with the prompt.
   */
  restage(sessionId: SessionId, ids: readonly DraftAttachmentId[], uploadImages: boolean): void
  /**
   * Wait until every listed draft can be sent: its upload is ready, or it has
   * none and sends inline.
   * @throws when an upload fails or the signal aborts.
   */
  whenReady(ids: readonly DraftAttachmentId[], signal: AbortSignal): Promise<void>
}

function uploadStore(value: unknown): UploadStore | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<UploadStore>
  return typeof candidate.getSnapshot === 'function' && typeof candidate.subscribe === 'function'
    ? candidate as UploadStore
    : undefined
}

/**
 * Resolve the staging face of the Conversation service.
 * @param conversation - the `ctx.conversation` service.
 * @returns the staging face, or undefined when this Harness does not expose it.
 */
export function draftAttachmentStaging(conversation: unknown): DraftAttachmentStaging | undefined {
  if (typeof conversation !== 'object' || conversation === null) return undefined
  const service = conversation as {
    rebindDraftFiles?: (sessionId: SessionId, ids: readonly DraftAttachmentId[], uploadImages: boolean) => void
    fileUploads?: unknown
  }
  const uploads = uploadStore(service.fileUploads)
  if (typeof service.rebindDraftFiles !== 'function' || uploads === undefined) return undefined
  return {
    restage: (sessionId, ids, uploadImages) => {
      service.rebindDraftFiles!(sessionId, ids, uploadImages)
    },
    whenReady: (ids, signal) => new Promise<void>((resolve, reject) => {
      let stop: (() => void) | undefined
      let settled = false
      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        stop?.()
        signal.removeEventListener('abort', onAbort)
        finish()
      }
      const onAbort = (): void => { settle(() => { reject(signal.reason) }) }
      const check = (): boolean => {
        if (settled) return true
        const snapshot = uploads.getSnapshot()
        for (const id of ids) {
          const upload = snapshot[id]
          if (upload === undefined || upload.status === 'ready') continue
          if (upload.status === 'error') {
            const message = typeof upload.message === 'string' ? upload.message : 'upload failed'
            settle(() => { reject(new Error(message)) })
            return true
          }
          return false
        }
        settle(resolve)
        return true
      }
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (check()) return
      stop = uploads.subscribe(() => { check() })
      // An upload may have settled between the first read and the subscription.
      if (settled) stop()
      else check()
    }),
  }
}
