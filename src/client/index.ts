/** Browser plugin: Conversation Graph selection and merge-only Chat creation. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../connection-contract.ts'
import {
  CREATE_MERGED_SESSION_RPC_ENDPOINT,
  HISTORY_PREVIEW_RPC_ENDPOINT,
  PROJECT_GRAPH_RPC_CHANNEL,
  PROJECT_GRAPH_RPC_ENDPOINT,
  decodeCreateMergedSessionResponse,
  decodeHistoryPreviewResponse,
  decodeProjectGraphResponse,
  type HistoryPreviewImageAttachment,
} from '../protocol.ts'
import { GraphView, type GraphViewInjected } from './GraphView.tsx'
import { ComposerBlockLease } from './composer-block-lease.ts'
import { connectionGraphTransport } from './graph-transport.ts'
import { installLocaleSource, localized } from './i18n.ts'
import { installProjectBridge } from './project-bridge.tsx'
import { STYLES } from './styles.ts'
import type { TurnNodeId } from './types.ts'
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
  ctx.effect(() => installLocaleSource(ctx.locale), 'dsh-git: locale source')
  ctx.effect(installStyles, 'dsh-git: stylesheet')
  ctx.effect(() => installProjectBridge({
    connection: ctx.connection,
    sessions,
    workspaces: ctx.workspaces,
    locale: ctx.locale,
    repositoryForWorkspace: workspaceId => repositories.forWorkspace(workspaceId),
  }), 'dsh-git: project graph compatibility bridge')

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
          'Context 尚未 Merge，或新 Chat 正在创建；请完成 Merge 或放弃更改。',
          'Context is unmerged or a new Chat is being created; finish the Merge or discard the changes.',
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
        hooks: { graph: repository },
        syncTurns: turns => {
          repository.syncSession(sessionId, turns)
          repository.reconcileOfficialForks(sessionParents())
        },
        adoptObservedGraph: state => repository.adoptObservedGraph(state),
        loadProjectGraph: async (signal) => {
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
          return { response, sessionTitles: sessionTitles(sessions) }
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
        createMergedSession: async (manifest: readonly TurnNodeId[], draft, signal) => {
          signal.throwIfAborted()
          if (draft.hasStructuredReferences) {
            throw new Error(localized(
              '输入草稿包含无法跨 Session 转移的结构化引用。',
              'The draft contains structured references that cannot move between Sessions.',
            ))
          }
          const state = repository.getSnapshot()
          const selected = manifest.flatMap(nodeId => state.nodes[nodeId] === undefined ? [] : [state.nodes[nodeId]!])
          if (selected.length !== manifest.length || selected.length === 0) {
            throw new Error(localized('至少一个所选 PA 已失效，请重新选择。', 'At least one selected PA is stale; select the context again.'))
          }
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
              sources: selected.map(node => ({
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
            importedNodeIds: manifest,
            parentIds: manifest,
            primaryParentId: manifest.at(-1) ?? null,
            contextManifest: manifest,
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
