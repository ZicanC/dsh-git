/** DOM compatibility bridge for project-row buttons and the main-area takeover page. */
import { createRoot, type Root } from 'react-dom/client'
import type {
  ISessions, IWorkspaces, SessionId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectConnection } from '../connection-contract.ts'
import type { GraphRepository } from './repository.ts'
import { ProjectGraphPage } from './ProjectGraphPage.tsx'
import { localized } from './i18n.ts'
import type { LocaleSource } from './i18n.ts'
import {
  PROJECT_GRAPH_RPC_CHANNEL,
  PROJECT_GRAPH_RPC_ENDPOINT,
  decodeProjectGraphResponse,
} from '../protocol.ts'

const BUTTON_ATTRIBUTE = 'data-dsh-git-project-button'
const HOST_ATTRIBUTE = 'data-dsh-git-project-host'

export interface ProjectBridgeServices {
  readonly connection: ProjectConnection
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly repositoryForWorkspace: (workspaceId: string) => GraphRepository
  readonly locale: LocaleSource
}

interface ActivePage {
  readonly container: HTMLDivElement
  readonly owner: HTMLElement
  readonly root: Root
}

function graphIcon(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 3.5h3v3H3zM10 2h3v3h-3zM10 10h3v3h-3zM5.7 4.5h4.6M11.5 5v5M5.5 6.3l5 4.2" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>'
}

function workspaceRow(workspace: WorkspaceView, used: ReadonlySet<HTMLElement>): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded]')]
    .find(row => !used.has(row)
      && row.querySelectorAll('button').length >= 2
      && [...row.querySelectorAll('span')]
        .some(span => span.textContent?.trim() === workspace.title))
}

function sessionTitles(sessions: ISessions): Readonly<Record<string, string>> {
  const snapshot = sessions.list.getSnapshot()
  return Object.fromEntries(snapshot.ids.flatMap(id => {
    const summary = snapshot.byId[id]
    return summary === undefined ? [] : [[id, summary.displayTitle]]
  }))
}

/** Install the isolated compatibility layer and return its complete disposer. */
export function installProjectBridge(services: ProjectBridgeServices): () => void {
  let active: ActivePage | null = null

  const close = (): void => {
    if (active === null) return
    const page = active
    active = null
    page.root.unmount()
    page.container.remove()
    page.owner.classList.remove('dsh-git-project-host-open')
  }

  const open = (workspace: WorkspaceView): void => {
    close()
    const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    const owner = scroll?.parentElement
    if (owner === null || owner === undefined) return
    owner.classList.add('dsh-git-project-host-open')
    const container = document.createElement('div')
    container.setAttribute(HOST_ATTRIBUTE, workspace.workspaceId)
    owner.appendChild(container)
    const root = createRoot(container)
    active = { container, owner, root }
    const repository = services.repositoryForWorkspace(workspace.workspaceId)
    const load = async (signal: AbortSignal) => {
      const result = await services.connection.rpc.call(
        PROJECT_GRAPH_RPC_CHANNEL,
        PROJECT_GRAPH_RPC_ENDPOINT,
        { workspaceId: workspace.workspaceId },
        signal,
      )
      if (!result.ok) throw new Error(result.error.message)
      const response = decodeProjectGraphResponse(result.value)
      if (response.workspaceId !== workspace.workspaceId) throw new Error(localized('Host 返回了错误的 Workspace graph。', 'The Host returned a graph for the wrong Workspace.'))
      return response
    }
    root.render(<ProjectGraphPage
      workspaceId={workspace.workspaceId}
      workspaceTitle={workspace.title}
      sessionTitles={sessionTitles(services.sessions)}
      load={load}
      getLocalState={repository.getSnapshot}
      onClose={() => { queueMicrotask(close) }}
      onOpenSession={(sessionId) => {
        queueMicrotask(() => {
          close()
          services.sessions.open(sessionId as SessionId)
        })
      }}
    />)
  }

  const scan = (): void => {
    const workspaces = services.workspaces.list.getSnapshot().items
    const used = new Set<HTMLElement>()
    for (const workspace of workspaces) {
      const row = workspaceRow(workspace, used)
      if (row === undefined) continue
      used.add(row)
      const existing = row.querySelector<HTMLElement>(`[${BUTTON_ATTRIBUTE}]`)
      if (existing !== null && existing.getAttribute(BUTTON_ATTRIBUTE) === workspace.workspaceId) {
        existing.setAttribute('aria-label', localized(`打开“${workspace.title}”的 Conversation Graph`, `Open the Conversation Graph for “${workspace.title}”`))
        continue
      }
      existing?.remove()
      const buttons = row.querySelectorAll<HTMLButtonElement>('button')
      const anchor = buttons.item(buttons.length - 1)
      if (anchor === null) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = anchor.className
      button.setAttribute(BUTTON_ATTRIBUTE, workspace.workspaceId)
      button.setAttribute('aria-label', localized(`打开“${workspace.title}”的 Conversation Graph`, `Open the Conversation Graph for “${workspace.title}”`))
      button.title = 'Conversation Graph'
      button.innerHTML = graphIcon()
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        open(workspace)
      })
      anchor.before(button)
    }
  }

  let queued = false
  const queueScan = (): void => {
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; scan() })
  }
  const observer = new MutationObserver(queueScan)
  observer.observe(document.body, { childList: true, subtree: true })
  const unsubscribeWorkspaces = services.workspaces.list.subscribe(queueScan)
  const unsubscribeLocale = services.locale.subscribe(queueScan)
  scan()

  return () => {
    observer.disconnect()
    unsubscribeWorkspaces()
    unsubscribeLocale()
    close()
    document.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`).forEach(button => { button.remove() })
  }
}
