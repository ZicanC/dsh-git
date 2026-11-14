import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
/** Browser plugin: Conversation Graph selection and merge-only Chat creation. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DraftAttachmentId, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '../connection-contract.ts'
import {
  ANCHORED_SESSION_PREFIX,
  CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT,
  CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT,
  CREATE_ANCHORED_SESSION_RPC_ENDPOINT,
  CREATE_MERGED_SESSION_RPC_ENDPOINT,
  HISTORY_PREVIEW_RPC_ENDPOINT,
  PROJECT_GRAPH_RPC_CHANNEL,
  PROJECT_GRAPH_RPC_ENDPOINT,
  decodeCancelAnchorWorkspaceResponse,
  decodeCreateAnchorWorkspaceResponse,
  decodeCreateAnchoredSessionResponse,
  decodeCreateMergedSessionResponse,
  decodeHistoryPreviewResponse,
  decodeProjectGraphResponse,
  type HistoryPreviewImageAttachment,
} from '../protocol.ts'
import { ComposerDiscardAction, type ComposerDiscardActionInjected } from './ComposerDiscardAction.tsx'
import { ContextTrayDock, type ContextTrayDockInjected } from './ContextTrayDock.tsx'
import { GraphView, type GraphViewInjected } from './GraphView.tsx'
import { ComposerBlockLease } from './composer-block-lease.ts'
import { ContextTrayChannels } from './context-tray-channel.ts'
import { draftAttachmentStaging } from './draft-attachments.ts'
import { connectionGraphTransport } from './graph-transport.ts'
import { contextReferences, resolveContextReferences, lineageParentPlan, normalizeContextOccurrences } from './graph.ts'
import { installLocaleSource, localized } from './i18n.ts'
import { nodeLabelMap } from './labels.ts'
import { installProjectBridge } from './project-bridge.tsx'
import { restoreAnchorSourceLabels } from './project-graph.ts'
import { STYLES } from './styles.ts'
import type { GraphState, TurnNodeId } from './types.ts'
import { WorkspaceGraphRepositories } from './workspace-repositories.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A dsh-git operation holding a Session it created or reads but does not display. */
    dshGit: unknown
  }
}

/** Required client services: conversation view/input, sessions, Workspace, navigation, and locale. */
export const inject = ['connection', 'slots', 'sessions', 'workspaces', 'locale', 'conversation', 'uiWorkspace']

function installStyles(): () => void {
  const existing = document.querySelector<HTMLStyleElement>('style[data-plugin="dsh-git"]')
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-git'
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

function createSessionId(): SessionId {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `dsh-git-${suffix}` as SessionId
}

function createAnchoredSessionId(): SessionId {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${ANCHORED_SESSION_PREFIX}${suffix}` as SessionId
}

async function pollingDelay(signal?: AbortSignal): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
  signal?.throwIfAborted()
}

/**
 * Retain a Session the Host has just created for this plugin.
 *
 * A Session has a binding in the browser only while something retains it, and
 * the last release tears its scope down together with any unsent draft. The
 * caller therefore keeps the returned reference until the draft it placed has
 * either been sent or handed to the main view.
 * @returns the opened reference, or undefined when the Session cannot be opened.
 */
async function retainCreatedSession(
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
function submissionAccepted(input: SessionInput, signal: AbortSignal): Promise<boolean> {
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
type AttachmentHandOver =
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
function handOverAttachments(
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

/** Select the plugin tab after navigation creates the child Session's header. */
async function activateBranchesTab(sessions: ISessions, sessionId: SessionId): Promise<boolean> {
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

function sessionTitles(sessions: ISessions): Readonly<Record<string, string>> {
  const snapshot = sessions.list.getSnapshot()
  return Object.fromEntries(snapshot.ids.flatMap(id => {
    const item = snapshot.byId[id]
    return item === undefined ? [] : [[String(id), item.displayTitle]]
  }))
}

function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Mount the browser graph view and its Workspace-isolated repository. */
export function apply(ctx: Context): void {
  // Host and browser packages both augment Cordis' sessions name; this bundle runs on the browser face.
  const sessions = ctx.sessions as unknown as ISessions
  const repositories = new WorkspaceGraphRepositories(
    ctx.workspaces,
    connectionGraphTransport(ctx.connection),
  )
  const contextTrays = new ContextTrayChannels()
  // Official forks and the Session each was taken from, as the Host last
  // reported them. The browser's session list no longer carries this.
  const forkOrigins = new Map<string, string>()
  const anchorDispatches = new Map<string, AbortController>()
  ctx.effect(() => () => {
    for (const controller of anchorDispatches.values()) controller.abort()
    anchorDispatches.clear()
  }, 'dsh-git: anchor dispatch cleanup')
  ctx.effect(() => installLocaleSource(ctx.locale), 'dsh-git: locale source')
  ctx.effect(installStyles, 'dsh-git: stylesheet')
  ctx.effect(() => installProjectBridge({
    connection: ctx.connection,
    sessions,
    openSession: sessionId => { ctx.uiWorkspace.openSession(sessionId) },
    workspaces: ctx.workspaces,
    locale: ctx.locale,
    repositoryForWorkspace: workspaceId => repositories.forWorkspace(workspaceId),
    repositoryForSession: sessionId => repositories.forSession(sessionId),
  }), 'dsh-git: project graph compatibility bridge')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-git-context-tray',
    order: 15,
    inject: (sessionId: SessionId): ContextTrayDockInjected => ({
      hooks: { tray: contextTrays.forSession(String(sessionId)) },
    }),
  }, ContextTrayDock))

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'dsh-git-discard-context',
    order: 10,
    inject: (sessionId: SessionId): ComposerDiscardActionInjected => {
      const repository = repositories.forSession(sessionId)
      const dispatchAnchoredDraft = (): void => {
        const key = String(sessionId)
        if (anchorDispatches.has(key)) return
        const anchor = repository.getSnapshot().anchors[key]
        if (anchor === undefined) return
        const controller = new AbortController()
        anchorDispatches.set(key, controller)
        void (async () => {
          const sourceBinding = sessions.binding(sessionId)
          if (sourceBinding === undefined) throw new Error(localized(
            '无法访问当前 Chat 的输入草稿。',
            'Cannot access the current Chat draft.',
          ))
          const sourceInput = ctx.conversation.input.for(sourceBinding.ctx)
          const draft = sourceInput.state.getSnapshot()
          if (draft.phase !== 'plain') throw new Error(localized(
            '输入框正在处理另一项操作，请稍后再发送。',
            'The composer is handling another operation. Try again shortly.',
          ))
          if (draft.occurrences.length > 0) throw new Error(localized(
            '锚点问题不能包含 @ 引用或其他结构化 chip。',
            'Anchored questions cannot contain @ references or other structured chips.',
          ))
          if (draft.draft.trim() === '' && draft.attachmentIds.length === 0) return
          const state = repository.getSnapshot()
          const currentAnchor = state.anchors[key]
          if (currentAnchor === undefined
            || currentAnchor.workspaceId !== anchor.workspaceId
            || !sameValues(currentAnchor.nodeIds, anchor.nodeIds)) {
            throw new Error(localized(
              '锚点在发送期间已变化，请重新发送。',
              'The anchor changed during dispatch. Send again.',
            ))
          }
          const selected = anchor.nodeIds.flatMap(nodeId => state.nodes[nodeId] === undefined
            ? []
            : [state.nodes[nodeId]!])
          if (selected.length !== anchor.nodeIds.length || selected.length === 0) {
            throw new Error(localized(
              '固定的 PA 已失效，请取消后重新锚定。',
              'A fixed PA is stale. Cancel and create the anchor again.',
            ))
          }
          const childSessionId = createAnchoredSessionId()
          const labels = nodeLabelMap(state)
          const result = await ctx.connection.rpc.call(
            PROJECT_GRAPH_RPC_CHANNEL,
            CREATE_ANCHORED_SESSION_RPC_ENDPOINT,
            {
              targetSessionId: childSessionId,
              workspaceId: anchor.workspaceId,
              sources: selected.map(node => ({
                sourceSessionId: node.sessionId,
                sourceTurn: node.turn,
                sourceBoundarySeq: node.boundarySeq,
                sourceLabel: labels.get(node.id) ?? `PA${node.turn}`,
              })),
            },
            controller.signal,
          )
          if (!result.ok) throw new Error(localized(
            `创建锚点子问题失败：${result.error.message}`,
            `Failed to create the anchored question: ${result.error.message}`,
          ))
          const response = decodeCreateAnchoredSessionResponse(result.value)
          if (response.targetSessionId !== childSessionId) throw new Error(localized(
            'Host 返回了错误的锚点子会话 ID。',
            'The Host returned the wrong anchored child Session ID.',
          ))
          const child = await retainCreatedSession(sessions, childSessionId, controller.signal)
          if (child === undefined) throw new Error(localized(
            `子会话 ${childSessionId} 已创建，但尚未到达浏览器；原草稿未清除。`,
            `Child Session ${childSessionId} was created but has not reached the browser; the source draft was preserved.`,
          ))
          const childInput = ctx.conversation.input.for(child.binding.ctx)
          let accepted = false
          let returnAttachments: (() => void) | undefined
          try {
            const sourceUnchanged = (): boolean => {
              const latest = sourceInput.state.getSnapshot()
              return latest.phase === 'plain'
                && latest.draftRev === draft.draftRev
                && latest.draft === draft.draft
                && sameValues(latest.attachmentIds, draft.attachmentIds)
                && latest.occurrences.length === 0
            }
            const assertSourceUnchanged = (): void => {
              if (sourceUnchanged()) return
              throw new Error(localized(
                '子会话已创建，但原草稿在期间发生变化；为避免覆盖，草稿未清除或发送。',
                'The child Session was created, but the source draft changed; it was not cleared or sent.',
              ))
            }
            assertSourceUnchanged()
            const handOver = handOverAttachments(
              ctx.conversation, draft.attachmentIds, sourceBinding, child.binding, childInput,
            )
            if (!handOver.ok) {
              throw new Error(localized(
                '子会话已创建，但附件无法转移；原草稿未清除。',
                'The child Session was created, but its attachments could not be transferred; the source draft was preserved.',
              ))
            }
            returnAttachments = handOver.undo
            try {
              // The child sends at once, so its uploads must have finished first.
              await handOver.whenReady(controller.signal)
            } catch (cause: unknown) {
              if (controller.signal.aborted) throw cause
              throw new Error(localized(
                `子会话已创建，但附件未能上传到子会话：${cause instanceof Error ? cause.message : String(cause)}；原草稿未清除。`,
                `The child Session was created, but its attachments could not be uploaded to it: ${cause instanceof Error ? cause.message : String(cause)}; the source draft was preserved.`,
              ))
            }
            assertSourceUnchanged()
            childInput.setDraft(draft.draft)
            childInput.submit()
            if (childInput.state.getSnapshot().phase === 'plain') {
              throw new Error(localized(
                '子会话已创建，但问题未能提交；原草稿未清除。',
                'The child Session was created, but the question could not be submitted; the source draft was preserved.',
              ))
            }
            // The source composer keeps the question until the Host has taken
            // it: the child is not on screen, so a refused question would
            // otherwise be lost together with the child's composer.
            accepted = await submissionAccepted(childInput, controller.signal)
            if (!accepted) {
              throw new Error(localized(
                '子会话未接受该问题；问题仍保留在输入框中。',
                'The child Session did not accept the question; it is still in the composer.',
              ))
            }
            // Text typed while the question was being admitted is newer input and stays.
            if (sourceUnchanged()) sourceInput.setDraft('')
            for (const attachmentId of draft.attachmentIds) sourceInput.removeAttachment(attachmentId)
            sourceInput.notify('info', localized(
              `已发送到「${anchor.workspaceTitle}」中的独立子会话。`,
              `Sent to an independent child Session in “${anchor.workspaceTitle}”.`,
            ))
          } finally {
            if (!accepted) returnAttachments?.()
            // Only this reference kept the unseen child's composer alive.
            child.release()
          }
        })().catch((cause: unknown) => {
          if (controller.signal.aborted) return
          const binding = sessions.binding(sessionId)
          const message = cause instanceof Error ? cause.message : String(cause)
          if (binding === undefined) console.error('dsh-git anchor dispatch failed:', cause)
          else ctx.conversation.input.for(binding.ctx).notify('error', message)
        }).finally(() => {
          if (anchorDispatches.get(key) === controller) anchorDispatches.delete(key)
        })
      }
      return {
        sessionId: String(sessionId),
        hooks: {
          tray: contextTrays.forSession(String(sessionId)),
          graph: repository,
        },
        dispatchAnchoredDraft,
      }
    },
  }, ComposerDiscardAction))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'dsh-git',
    order: 20,
    label: () => localized('分支', 'Branches'),
    inject: (sessionId: SessionId): GraphViewInjected => {
      const repository = repositories.forSession(sessionId)
      const composerBlock = new ComposerBlockLease(
        ctx.conversation.blocks,
        sessionId,
        () => localized(
          '新 Chat 正在创建；草稿正在转移，请稍候。',
          'A new Chat is being created; the draft is being transferred, please wait.',
        ),
      )
      const workspace = () => ctx.workspaces.list.getSnapshot().items
        .find(candidate => candidate.sessionIds.some((id: string) => String(id) === String(sessionId)))
      const sessionParents = (): Record<string, string> => ({
        ...Object.fromEntries(forkOrigins),
        ...Object.fromEntries(Object.values(sessions.list.getSnapshot().byId).flatMap(item =>
          item.parentId === undefined ? [] : [[String(item.id), String(item.parentId)]])),
      })
      repository.reconcileOfficialForks(sessionParents())

      return {
        tray: contextTrays.forSession(String(sessionId)),
        hooks: { graph: repository },
        persistenceError: () => repository.persistenceError?.message ?? null,
        // One commit: a fork's copied prefix is recognised before it is numbered.
        syncTurns: turns => { repository.syncSession(sessionId, turns, sessionParents()) },
        adoptObservedGraph: state => repository.adoptObservedGraph(state),
        loadProjectGraph: async (signal) => {
          await repository.hydrate()
          const owner = workspace()
          if (owner === undefined) return null
          const result = await ctx.connection.rpc.call(
            PROJECT_GRAPH_RPC_CHANNEL,
            PROJECT_GRAPH_RPC_ENDPOINT,
            { workspaceId: owner.workspaceId },
            signal,
          )
          if (!result.ok) throw new Error(result.error.message)
          const response = decodeProjectGraphResponse(result.value)
          if (response.workspaceId !== owner.workspaceId) {
            throw new Error(localized('Host 返回了错误的 Workspace graph。', 'The Host returned a graph for the wrong Workspace.'))
          }
          for (const item of response.sessions) {
            // A composed Session's parent is only the Session it was created under.
            if (item.mergeSources !== undefined) continue
            if (item.parentSessionId === undefined) forkOrigins.delete(item.sessionId)
            else forkOrigins.set(item.sessionId, item.parentSessionId)
          }
          const sourceIds = new Set(response.sessions.flatMap(item =>
            item.mergeSources?.flatMap(source => source.sourceLabel === undefined
              ? [source.sourceSessionId]
              : []) ?? []))
          const sourceStates = new Map<string, GraphState>()
          for (const sourceSessionId of sourceIds) {
            const sourceRepository = repositories.forSession(sourceSessionId)
            await sourceRepository.hydrate()
            sourceStates.set(sourceSessionId, sourceRepository.getSnapshot())
          }
          return {
            response: restoreAnchorSourceLabels(response, sourceStates),
            sessionTitles: sessionTitles(sessions),
          }
        },
        loadHistoryPreview: async (sources, signal) => {
          const result = await ctx.connection.rpc.call(
            PROJECT_GRAPH_RPC_CHANNEL,
            HISTORY_PREVIEW_RPC_ENDPOINT,
            { sources },
            signal,
          )
          if (!result.ok) throw new Error(result.error.message)
          return decodeHistoryPreviewResponse(result.value)
        },
        loadPreviewImage: async (sourceSessionId: string, attachment: HistoryPreviewImageAttachment) => {
          // The source Session of a previewed PA is usually not the one on screen,
          // so it is retained for the duration of the read.
          const result = await sessions.using(
            sourceSessionId as SessionId,
            { source: 'dshGit' },
            reference => reference.binding.session.readAttachment(attachment.attachmentId as never),
          )
          if (!result.ok) throw new Error(result.error.message)
          const bytes = new Uint8Array(result.value.data)
          const url = URL.createObjectURL(new Blob([bytes.buffer], { type: attachment.mediaType }))
          return { url, release: () => URL.revokeObjectURL(url) }
        },
        setComposerBlocked: blocked => composerBlock.setBlocked(blocked),
        activateAnchor: async (manifest, signal) => {
          signal.throwIfAborted()
          const owner = workspace()
          if (owner === undefined) throw new Error(localized(
            '当前 Chat 不属于任何 Workspace，无法创建锚点目录。',
            'The current Chat is not in a Workspace, so an anchor directory cannot be created.',
          ))
          const state = repository.getSnapshot()
          const selected = manifest.flatMap(nodeId => state.nodes[nodeId] === undefined
            ? []
            : [state.nodes[nodeId]!])
          if (selected.length !== manifest.length || selected.length === 0) throw new Error(localized(
            '至少一个所选 PA 已失效，请重新选择。',
            'At least one selected PA is stale; select the context again.',
          ))
          const title = localized(`锚点问题 · ${owner.title}`, `Anchored questions · ${owner.title}`)
          const sources = selected.map(node => ({
            sourceSessionId: node.sessionId,
            sourceTurn: node.turn,
            sourceBoundarySeq: node.boundarySeq,
          }))
          const result = await ctx.connection.rpc.call(
            PROJECT_GRAPH_RPC_CHANNEL,
            CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT,
            { sourceSessionId: String(sessionId), title, sources },
            signal,
          )
          if (!result.ok) throw new Error(localized(
            `创建锚点目录失败：${result.error.message}`,
            `Failed to create the Anchor directory: ${result.error.message}`,
          ))
          const anchorWorkspace = decodeCreateAnchorWorkspaceResponse(result.value)
          const anchor = {
            sourceSessionId: String(sessionId),
            nodeIds: [...manifest],
            workspaceId: anchorWorkspace.workspaceId,
            workspacePath: anchorWorkspace.workspacePath,
            workspaceTitle: anchorWorkspace.workspaceTitle,
            createdAt: Date.now(),
          }
          repository.activateAnchor(String(sessionId), anchor)
          return anchor
        },
        cancelAnchor: async signal => {
          signal.throwIfAborted()
          const key = String(sessionId)
          const state = repository.getSnapshot()
          const anchor = state.anchors[key]
          if (anchor === undefined) return
          const sources = anchor.nodeIds.flatMap(nodeId => {
            const node = state.nodes[nodeId]
            return node === undefined ? [] : [{
              sourceSessionId: node.sessionId,
              sourceTurn: node.turn,
              sourceBoundarySeq: node.boundarySeq,
            }]
          })
          const result = await ctx.connection.rpc.call(
            PROJECT_GRAPH_RPC_CHANNEL,
            CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT,
            {
              sourceSessionId: key,
              workspaceId: anchor.workspaceId,
              ...(sources.length === 0 ? {} : { sources }),
            },
            signal,
          )
          if (!result.ok) throw new Error(localized(
            `取消锚点失败：${result.error.message}`,
            `Failed to cancel the anchor: ${result.error.message}`,
          ))
          decodeCancelAnchorWorkspaceResponse(result.value)
          repository.cancelAnchor(key)
        },
        createMergedSession: async (manifest: readonly TurnNodeId[], draft, signal) => {
          signal.throwIfAborted()
          if (draft.hasStructuredReferences) {
            throw new Error(localized(
              '输入草稿包含无法跨 Session 转移的结构化引用。',
              'The draft contains structured references that cannot move between Sessions.',
            ))
          }
          const state = repository.getSnapshot()
          if (manifest.some(id => state.nodes[id] === undefined)) {
            throw new Error(localized('至少一个所选 PA 已失效，请重新选择。', 'At least one selected PA is stale; select the context again.'))
          }
          if (!repository.ready || repository.persistenceError !== null) {
            throw new Error(localized(
              '图账本尚未保存；请重新加载页面后再创建新 Chat。',
              'The graph is not saved. Reload the page before creating a new Chat.',
            ))
          }
          const contextRefs = draft.contextRefs ?? contextReferences(state, manifest)
          const contextManifest = resolveContextReferences(state, contextRefs)
          const selected = contextManifest.flatMap(nodeId => state.nodes[nodeId] === undefined ? [] : [state.nodes[nodeId]!])
          if (selected.length !== contextManifest.length || selected.length === 0) {
            throw new Error(localized('至少一个所选 PA 已失效，请重新选择。', 'At least one selected PA is stale; select the context again.'))
          }
          const parents = lineageParentPlan(state, contextManifest, contextRefs)
          const sourceBinding = sessions.binding(sessionId)
          if (sourceBinding === undefined) {
            throw new Error(localized('无法访问当前 Chat 的输入草稿。', 'Cannot access the current Chat draft.'))
          }

          const childSessionId = createSessionId()
          const result = await ctx.connection.rpc.call(
            PROJECT_GRAPH_RPC_CHANNEL,
            CREATE_MERGED_SESSION_RPC_ENDPOINT,
            {
              targetSessionId: childSessionId,
              sources: selected.map((node, index) => ({
                viaSessionId: contextRefs[index]!.viaSessionId,
                sourceSessionId: node.sessionId,
                sourceTurn: node.turn,
                sourceBoundarySeq: node.boundarySeq,
              })),
            },
            signal,
          )
          if (!result.ok) {
            throw new Error(localized(`创建新 Chat 失败：${result.error.message}`, `Failed to create the new Chat: ${result.error.message}`))
          }
          const response = decodeCreateMergedSessionResponse(result.value)
          if (response.targetSessionId !== childSessionId) {
            throw new Error(localized(
              'Host 返回了错误的新 Chat ID。',
              'The Host returned the wrong new Chat ID.',
            ))
          }
          signal.throwIfAborted()

          repositories.pinSession(childSessionId, repository)
          repository.prepareMergedSession({
            childSessionId,
            importedNodeIds: contextManifest,
            contextRefs,
            parentIds: parents.parentIds,
            primaryParentId: parents.primaryParentId,
            contextManifest,
          })
          const child = await retainCreatedSession(sessions, childSessionId, signal)
          if (child === undefined) {
            throw new Error(localized(
              `新 Chat ${childSessionId} 已创建，但浏览器尚未收到对应 Session；原草稿未改动。`,
              `The new Chat ${childSessionId} was created, but its Session has not reached the browser; the source draft was preserved.`,
            ))
          }
          // Resolved while the reference is held: a released reference has no binding.
          const childInput = ctx.conversation.input.for(child.binding.ctx)
          try {
            const sourceInput = ctx.conversation.input.for(sourceBinding.ctx)
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
              ctx.conversation, draft.attachmentIds, sourceBinding, child.binding, childInput,
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
              ctx.uiWorkspace.openSession(childSessionId)
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
        },
      }
    },
  }, GraphView))
}
