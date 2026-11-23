/** Creating a new Chat from the selected Context: a Fork or a Merge. */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContextRef } from '../graph-state.ts'
import {
  contextReferences, hostCoordinates, lineageParentPlan, resolveContextReferences, selectedNodes,
} from './graph.ts'
import { rewordRefusal, type HostRpc } from './host-rpc.ts'
import { localized } from './i18n.ts'
import { randomSuffix } from './ids.ts'
import type { GraphRepository } from './repository.ts'
import {
  activateBranchesTab, handOverAttachments, retainCreatedSession, sameValues, type ComposerAccess,
} from './session-handoff.ts'
import type { TurnNodeId } from './types.ts'

/** The source Chat's draft as the view saw it when the user asked for the new Chat. */
export interface MergeDraftTransfer {
  /** The selection as history paths; derived from the manifest when omitted. */
  readonly contextRefs?: readonly ContextRef[]
  readonly text: string
  readonly draftRevision: number
  readonly attachmentIds: readonly DraftAttachmentId[]
  readonly hasStructuredReferences: boolean
}

/** What creating a Chat needs from the browser. */
export interface MergedChatServices {
  readonly sessions: ISessions
  readonly composers: ComposerAccess
  readonly rpc: HostRpc
  /** Show a Session in the main view. */
  readonly openSession: (sessionId: SessionId) => void
  /** Keep a Session on a ledger until its Workspace membership reaches the browser. */
  readonly pinSession: (sessionId: SessionId, repository: GraphRepository) => void
}

const STALE_SELECTION = (): string =>
  localized('至少一个所选 PA 已失效，请重新选择。', 'At least one selected PA is stale; select the context again.')

/**
 * Create a Chat whose history is the selected PAs, move the source Chat's
 * draft into it, and open it on the Branches tab.
 *
 * The Host composes the seed; the ledger records the child's lineage before
 * its Session reaches the browser. The draft moves only if it is still the
 * one the user saw, and never to a Chat that then fails to open.
 * @param manifest - the selected PAs in Context order.
 * @throws with a message for the user; unless it says otherwise the source
 *   draft is untouched.
 */
export async function createMergedChat(
  services: MergedChatServices,
  repository: GraphRepository,
  sessionId: SessionId,
  manifest: readonly TurnNodeId[],
  draft: MergeDraftTransfer,
  signal: AbortSignal,
): Promise<void> {
  const { sessions, composers, rpc } = services
  signal.throwIfAborted()
  if (draft.hasStructuredReferences) {
    throw new Error(localized(
      '输入草稿包含无法跨 Session 转移的结构化引用。',
      'The draft contains structured references that cannot move between Sessions.',
    ))
  }
  const state = repository.getSnapshot()
  if (manifest.some(id => state.nodes[id] === undefined)) throw new Error(STALE_SELECTION())
  if (!repository.ready || repository.persistenceError !== null) {
    throw new Error(localized(
      '图账本尚未保存；请重新加载页面后再创建新 Chat。',
      'The graph is not saved. Reload the page before creating a new Chat.',
    ))
  }
  const contextRefs = draft.contextRefs ?? contextReferences(state, manifest)
  const contextManifest = resolveContextReferences(state, contextRefs)
  const selected = selectedNodes(state, contextManifest)
  if (selected === undefined) throw new Error(STALE_SELECTION())
  const parents = lineageParentPlan(state, contextManifest, contextRefs)
  const sourceBinding = sessions.binding(sessionId)
  if (sourceBinding === undefined) {
    throw new Error(localized('无法访问当前 Chat 的输入草稿。', 'Cannot access the current Chat draft.'))
  }

  const childSessionId = `dsh-git-${randomSuffix()}` as SessionId
  const response = await rpc.createMergedSession({
    targetSessionId: childSessionId,
    sources: selected.map((node, index) => ({
      viaSessionId: contextRefs[index]!.viaSessionId,
      ...hostCoordinates(node),
    })),
  }, signal).catch(rewordRefusal(message =>
    localized(`创建新 Chat 失败：${message}`, `Failed to create the new Chat: ${message}`)))
  if (response.targetSessionId !== childSessionId) {
    throw new Error(localized(
      'Host 返回了错误的新 Chat ID。',
      'The Host returned the wrong new Chat ID.',
    ))
  }
  signal.throwIfAborted()

  services.pinSession(childSessionId, repository)
  repository.prepareMergedSession({
    childSessionId,
    importedNodeIds: contextManifest,
    contextRefs,
    parentIds: parents.parentIds,
    primaryParentId: parents.primaryParentId,
    contextManifest,
    turnBoundaries: response.turnBoundaries,
  })
  const child = await retainCreatedSession(sessions, childSessionId, signal)
  if (child === undefined) {
    throw new Error(localized(
      `新 Chat ${childSessionId} 已创建，但浏览器尚未收到对应 Session；原草稿未改动。`,
      `The new Chat ${childSessionId} was created, but its Session has not reached the browser; the source draft was preserved.`,
    ))
  }
  // Resolved while the reference is held: a released reference has no binding.
  const childInput = composers.inputFor(child.binding)
  try {
    const sourceInput = composers.inputFor(sourceBinding)
    const sourceDraft = sourceInput.state.getSnapshot()
    if (sourceDraft.phase !== 'plain'
      || sourceDraft.draftRev !== draft.draftRevision
      || sourceDraft.draft !== draft.text
      || !sameValues(sourceDraft.attachmentIds, draft.attachmentIds)
      || sourceDraft.occurrences.length > 0) {
      throw new Error(localized(
        `新 Chat ${childSessionId} 已创建，但来源草稿在创建期间发生变化；为避免覆盖，新旧草稿均未转移或清除。`,
        `The new Chat ${childSessionId} was created, but the source draft changed during creation. Neither draft was moved or cleared, to avoid overwriting newer input.`,
      ))
    }
    signal.throwIfAborted()
    // No cancellation point from here to `openSession`: a draft placed in a
    // Chat that is never shown would be lost together with its scope.
    const handOver = handOverAttachments(
      composers.conversation, draft.attachmentIds, sourceBinding, child.binding, childInput,
    )
    if (!handOver.ok) {
      throw new Error(localized(
        `新 Chat ${childSessionId} 已创建，但草稿附件无法转移；原草稿未改动。`,
        `The new Chat ${childSessionId} was created, but its draft attachments could not be transferred; the source draft was preserved.`,
      ))
    }
    childInput.setDraft(draft.text)
    // The source is emptied before navigation: leaving the main view may
    // dispose its composer, which releases every attachment it still lists.
    sourceInput.setDraft('')
    for (const attachmentId of draft.attachmentIds) sourceInput.removeAttachment(attachmentId)
    try {
      // The main view retains the child before this operation lets go of it.
      services.openSession(childSessionId)
    } catch (cause: unknown) {
      handOver.undo()
      sourceInput.addAttachments(draft.attachmentIds)
      sourceInput.setDraft(draft.text)
      throw cause
    }
  } finally {
    child.release()
  }
  if (!await activateBranchesTab(sessions, childSessionId)) {
    childInput.notify('error', localized(
      '新 Chat 已创建并打开，但无法自动切回 Branches；请手动点击“分支”。',
      'The new Chat was created and opened, but Branches could not be activated automatically; click “Branches” manually.',
    ))
  }
}
