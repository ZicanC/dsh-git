import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
/** Browser plugin: Conversation Graph selection and merge-only Chat creation. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
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
import { connectionGraphTransport } from './graph-transport.ts'
import { contextReferences, resolveContextReferences, lineageParentPlan, normalizeContextOccurrences } from './graph.ts'
import { installLocaleSource, localized } from './i18n.ts'
import { nodeLabelMap } from './labels.ts'
import { installProjectBridge } from './project-bridge.tsx'
import { restoreAnchorSourceLabels } from './project-graph.ts'
import { STYLES } from './styles.ts'
import type { GraphState, TurnNodeId } from './types.ts'
import { WorkspaceGraphRepositories } from './workspace-repositories.ts'

/** Required client services: conversation view/input, sessions, Workspace, and locale. */
export const inject = ['connection', 'slots', 'sessions', 'workspaces', 'locale', 'conversation']

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

async function waitForSession(
  sessions: ISessions, sessionId: SessionId, signal: AbortSignal,
): Promise<SessionBinding | undefined> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    signal.throwIfAborted()
    const binding = sessions.binding(sessionId)
    if (binding !== undefined) return binding
    await pollingDelay(signal)
  }
  return undefined
}

/** Select the plugin tab after navigation creates the child Session's header. */
async function activateBranchesTab(sessions: ISessions, sessionId: SessionId): Promise<boolean> {
  let observedTargetSession = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (sessions.list.getSnapshot().current !== sessionId) {
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
          if (draft.draft.trim() === '' && draft.imageIds.length === 0) return
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
          const childBinding = await waitForSession(sessions, childSessionId, controller.signal)
          if (childBinding === undefined) throw new Error(localized(
            `子会话 ${childSessionId} 已创建，但尚未到达浏览器；原草稿未清除。`,
            `Child Session ${childSessionId} was created but has not reached the browser; the source draft was preserved.`,
          ))
          const latest = sourceInput.state.getSnapshot()
          if (latest.phase !== 'plain'
            || latest.draftRev !== draft.draftRev
            || latest.draft !== draft.draft
            || !sameValues(latest.imageIds, draft.imageIds)
            || latest.occurrences.length > 0) {
            throw new Error(localized(
              '子会话已创建，但原草稿在期间发生变化；为避免覆盖，草稿未清除或发送。',
              'The child Session was created, but the source draft changed; it was not cleared or sent.',
            ))
          }
          const childInput = ctx.conversation.input.for(childBinding.ctx)
          if (draft.imageIds.length > 0 && !childInput.addImages(draft.imageIds)) {
            throw new Error(localized(
              '子会话已创建，但图片无法转移；原草稿未清除。',
              'The child Session was created, but its images could not be transferred; the source draft was preserved.',
            ))
          }
          childInput.setDraft(draft.draft)
          childInput.submit()
          sourceInput.setDraft('')
          for (const imageId of draft.imageIds) sourceInput.removeImage(imageId)
          sourceInput.notify('info', localized(
            `已发送到「${anchor.workspaceTitle}」中的独立子会话。`,
            `Sent to an independent child Session in “${anchor.workspaceTitle}”.`,
          ))
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
      const sessionParents = (): Record<string, string> => Object.fromEntries(
        Object.values(sessions.list.getSnapshot().byId).flatMap(item => item.parentId === undefined
          ? []
          : [[String(item.id), String(item.parentId)]]),
      )
      repository.reconcileOfficialForks(sessionParents())

      return {
        tray: contextTrays.forSession(String(sessionId)),
        hooks: { graph: repository },
        persistenceError: () => repository.persistenceError?.message ?? null,
        syncTurns: turns => {
          repository.syncSession(sessionId, turns)
          repository.reconcileOfficialForks(sessionParents())
        },
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
          const binding = sessions.binding(sourceSessionId as SessionId)
          if (binding === undefined) throw new Error(`Cannot access preview image Session ${sourceSessionId}`)
          const result = await binding.session.readAttachment(attachment.attachmentId as never)
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
          if (manifest.some(id => state.nodes[id] === undefined)) throw new Error('A selected PA is no longer available')
          if (!repository.ready || repository.persistenceError !== null) throw new Error('Graph is not saved. Reload the page before creating a Session.')
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
          const childBinding = await waitForSession(sessions, childSessionId, signal)
          if (childBinding === undefined) {
            throw new Error(localized(
              `新 Chat ${childSessionId} 已创建，但浏览器尚未收到对应 Session；原草稿未改动。`,
              `The new Chat ${childSessionId} was created, but its Session has not reached the browser; the source draft was preserved.`,
            ))
          }

          const sourceInput = ctx.conversation.input.for(sourceBinding.ctx)
          const childInput = ctx.conversation.input.for(childBinding.ctx)
          const sourceDraft = sourceInput.state.getSnapshot()
          if (sourceDraft.phase !== 'plain'
            || sourceDraft.draftRev !== draft.draftRevision
            || sourceDraft.draft !== draft.text
            || !sameValues(sourceDraft.imageIds, draft.imageIds)
            || sourceDraft.occurrences.length > 0) {
            throw new Error(localized(
              `新 Chat ${childSessionId} 已创建，但来源草稿在创建期间发生变化；为避免覆盖，新旧草稿均未转移或清除。`,
              `The new Chat ${childSessionId} was created, but the source draft changed during creation. Neither draft was moved or cleared, to avoid overwriting newer input.`,
            ))
          }
          signal.throwIfAborted()
          if (draft.imageIds.length > 0 && !childInput.addImages(draft.imageIds)) {
            throw new Error(localized(
              `新 Chat ${childSessionId} 已创建，但图片草稿无法转移；原草稿未改动。`,
              `The new Chat ${childSessionId} was created, but its image draft could not be transferred; the source draft was preserved.`,
            ))
          }
          childInput.setDraft(draft.text)
          sourceInput.setDraft('')
          for (const imageId of draft.imageIds) sourceInput.removeImage(imageId)

          signal.throwIfAborted()
          sessions.open(childSessionId)
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
