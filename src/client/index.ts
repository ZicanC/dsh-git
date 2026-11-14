import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
/**
 * Browser plugin entry: registers the Branches view, the Context Tray dock,
 * and the composer action, and wires each to the ledger and the Host.
 *
 * The workflows themselves live beside this file — `./merged-chat.ts`,
 * `./anchor-mode.ts`, `./session-handoff.ts` — so what remains here is the
 * composition: which services each slot's component receives.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '../connection-contract.ts'
import type { HistoryPreviewImageAttachment, ProjectGraphResponse } from '../protocol.ts'
import { ComposerDiscardAction, type ComposerDiscardActionInjected } from './ComposerDiscardAction.tsx'
import { ContextTrayDock, type ContextTrayDockInjected } from './ContextTrayDock.tsx'
import { GraphView, type GraphViewInjected } from './GraphView.tsx'
import { activateAnchor, cancelAnchor, dispatchAnchoredQuestion } from './anchor-mode.ts'
import { ComposerBlockLease } from './composer-block-lease.ts'
import { ContextTrayChannels } from './context-tray-channel.ts'
import { connectionGraphTransport } from './graph-transport.ts'
import { hostRpc } from './host-rpc.ts'
import { installLocaleSource, localized } from './i18n.ts'
import { createMergedChat } from './merged-chat.ts'
import { installProjectBridge } from './project-bridge.tsx'
import type { ComposerAccess } from './session-handoff.ts'
import { STYLES } from './styles.ts'
import { readWorkspaceGraph, sessionTitles } from './workspace-graph.ts'
import { WorkspaceGraphRepositories } from './workspace-repositories.ts'

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

/**
 * Official forks and the Session each was taken from.
 *
 * The browser's session list carries a parent only for Sessions created on
 * Harness before 0.2.1-rc.3; for later forks the Host works the origin out
 * from the logs and reports it with the Workspace graph.
 */
class ForkOrigins {
  private readonly reported = new Map<string, string>()

  /** Take over what one Workspace graph says about its Sessions. */
  absorb(response: ProjectGraphResponse): void {
    for (const session of response.sessions) {
      // A composed Session's parent is only the Session it was created under.
      if (session.mergeSources !== undefined) continue
      if (session.parentSessionId === undefined) this.reported.delete(session.sessionId)
      else this.reported.set(session.sessionId, session.parentSessionId)
    }
  }

  /** Every known fork and its origin; a parent in the session list wins. */
  parents(sessions: ISessions): Record<string, string> {
    return {
      ...Object.fromEntries(this.reported),
      ...Object.fromEntries(Object.values(sessions.list.getSnapshot().byId).flatMap(item =>
        item.parentId === undefined ? [] : [[String(item.id), String(item.parentId)]])),
    }
  }
}

/** Mount the browser graph view and its Workspace-isolated repository. */
export function apply(ctx: Context): void {
  // Host and browser packages both augment Cordis' sessions name; this bundle runs on the browser face.
  const sessions = ctx.sessions as unknown as ISessions
  const rpc = hostRpc(ctx.connection)
  const composers: ComposerAccess = {
    inputFor: binding => ctx.conversation.input.for(binding.ctx),
    conversation: ctx.conversation,
  }
  const repositories = new WorkspaceGraphRepositories(
    ctx.workspaces,
    connectionGraphTransport(ctx.connection),
  )
  const contextTrays = new ContextTrayChannels()
  const forkOrigins = new ForkOrigins()
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
      /** Send the draft as an anchored question; one dispatch per Session at a time. */
      const dispatchAnchoredDraft = (): void => {
        const key = String(sessionId)
        if (anchorDispatches.has(key)) return
        const anchor = repository.getSnapshot().anchors[key]
        if (anchor === undefined) return
        const controller = new AbortController()
        anchorDispatches.set(key, controller)
        void dispatchAnchoredQuestion(
          { sessions, composers, rpc }, repository, sessionId, anchor, controller.signal,
        ).catch((cause: unknown) => {
          if (controller.signal.aborted) return
          const binding = sessions.binding(sessionId)
          const message = cause instanceof Error ? cause.message : String(cause)
          if (binding === undefined) console.error('dsh-git anchor dispatch failed:', cause)
          else composers.inputFor(binding).notify('error', message)
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
      repository.reconcileOfficialForks(forkOrigins.parents(sessions))

      return {
        tray: contextTrays.forSession(String(sessionId)),
        hooks: { graph: repository },
        persistenceError: () => repository.persistenceError?.message ?? null,
        // One commit: a fork's copied prefix is recognised before it is numbered.
        syncTurns: turns => { repository.syncSession(sessionId, turns, forkOrigins.parents(sessions)) },
        adoptObservedGraph: state => repository.adoptObservedGraph(state),
        loadProjectGraph: async (signal) => {
          await repository.hydrate()
          const owner = workspace()
          if (owner === undefined) return null
          const response = await readWorkspaceGraph(
            rpc, id => repositories.forSession(id), owner.workspaceId, signal,
          )
          forkOrigins.absorb(response)
          return { response, sessionTitles: sessionTitles(sessions) }
        },
        loadHistoryPreview: (sources, signal) => rpc.readHistoryPreview(sources, signal),
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
        activateAnchor: (manifest, signal) =>
          activateAnchor(rpc, repository, String(sessionId), workspace(), manifest, signal),
        cancelAnchor: signal => cancelAnchor(rpc, repository, String(sessionId), signal),
        createMergedSession: (manifest, draft, signal) => createMergedChat({
          sessions,
          composers,
          rpc,
          openSession: childSessionId => { ctx.uiWorkspace.openSession(childSessionId) },
          pinSession: (childSessionId, ledger) => { repositories.pinSession(childSessionId, ledger) },
        }, repository, sessionId, manifest, draft, signal),
      }
    },
  }, GraphView))
}
