/**
 * Handing a draft from the Chat on screen to a Session the plugin just created.
 *
 * A Session has a binding in the browser only while something retains it, and
 * the last release tears its scope down together with any unsent draft. The
 * helpers here hold such a Session for as long as a draft is on its way into
 * it, move the draft's attachments, and tell when the Host has taken a send.
 */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ISessions, SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DraftAttachmentId, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { draftAttachmentStaging } from './draft-attachments.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A dsh-git operation holding a Session it created or reads but does not display. */
    dshGit: unknown
  }
}

/** The composers of retained Sessions, and the service that stages their uploads. */
export interface ComposerAccess {
  /** The composer of a Session that is currently retained. */
  inputFor(binding: SessionBinding): SessionInput
  /** The `ctx.conversation` service, probed at runtime for its draft staging face. */
  readonly conversation: unknown
}

export function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function pollingDelay(signal?: AbortSignal): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
  signal?.throwIfAborted()
}

/**
 * Retain a Session the Host has just created for this plugin.
 *
 * The caller keeps the returned reference until the draft it placed has
 * either been sent or handed to the main view.
 * @returns the opened reference, or undefined when the Session cannot be opened.
 */
export async function retainCreatedSession(
  sessions: ISessions, sessionId: SessionId, signal: AbortSignal,
): Promise<SessionReference | undefined> {
  const reference = sessions.retain(sessionId, { source: 'dshGit', signal })
  try {
    await reference.ready
    signal.throwIfAborted()
    return reference
  } catch (cause: unknown) {
    reference.release()
    signal.throwIfAborted()
    console.error('dsh-git could not open the created Session:', cause)
    return undefined
  }
}

/** Whether a Session stages image uploads; a subagent continuation sends image bytes inline. */
function stagesImageUploads(binding: SessionBinding): boolean {
  return binding.session.getSnapshot().subagent === null
}

/**
 * Wait for the submission started on a composer to settle.
 *
 * The composer is frozen while the Host admits a message. An accepted message
 * empties it; a refused one returns it to editing with the draft intact.
 * @returns whether the Host took the message.
 * @throws when the signal aborts first.
 */
export function submissionAccepted(input: SessionInput, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
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
    const check = (): void => {
      const state = input.state.getSnapshot()
      if (state.phase !== 'plain' && state.phase !== 'claimed') return
      const taken = state.phase === 'plain' && state.draft.trim() === '' && state.attachmentIds.length === 0
      settle(() => { resolve(taken) })
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    check()
    if (settled) return
    stop = input.state.subscribe(check)
    if (settled) stop()
  })
}

/** A draft's attachments handed to another composer, with the way back. */
export type AttachmentHandOver =
  | {
    readonly ok: true
    /** Resolves once the receiving Session can send every attachment. */
    readonly whenReady: (signal: AbortSignal) => Promise<void>
    /** Take the attachments back, for a draft that stays with its source after all. */
    readonly undo: () => void
  }
  | { readonly ok: false }

/**
 * Hand a draft's attachments to another Session's composer and stage their
 * uploads for it, as Harness does when a draft follows a Workspace switch.
 * The source composer keeps listing them until the caller clears it.
 * @returns the hand-over, or `ok: false` with nothing moved.
 */
export function handOverAttachments(
  conversation: unknown,
  ids: readonly DraftAttachmentId[],
  source: SessionBinding,
  target: SessionBinding,
  targetInput: SessionInput,
): AttachmentHandOver {
  if (ids.length === 0) return { ok: true, whenReady: async () => {}, undo: () => {} }
  const staging = draftAttachmentStaging(conversation)
  if (staging === undefined || !targetInput.addAttachments(ids)) return { ok: false }
  staging.restage(target.sessionId, ids, stagesImageUploads(target))
  return {
    ok: true,
    whenReady: signal => staging.whenReady(ids, signal),
    undo: () => {
      for (const id of ids) targetInput.removeAttachment(id)
      staging.restage(source.sessionId, ids, stagesImageUploads(source))
    },
  }
}

/** Whether the main view currently shows this Session. */
function isMainSession(sessions: ISessions, sessionId: SessionId): boolean {
  return (sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0
}

/**
 * Select the plugin's tab once navigation has created the opened Session's header.
 * @returns whether the tab ended up selected before the attempts ran out.
 */
export async function activateBranchesTab(sessions: ISessions, sessionId: SessionId): Promise<boolean> {
  let observedTargetSession = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!isMainSession(sessions, sessionId)) {
      await pollingDelay()
      continue
    }
    // Let React replace the previous Session header before querying its tabs.
    if (!observedTargetSession) {
      observedTargetSession = true
      await pollingDelay()
      continue
    }
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(button => {
        const text = button.textContent?.trim()
        return text === '分支' || text === 'Branches'
      })
    if (tab !== undefined) {
      if (tab.getAttribute('aria-selected') === 'true') return true
      tab.click()
    }
    await pollingDelay()
  }
  return false
}
