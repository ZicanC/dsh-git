/** Host half: creates a new Agent from multiple selected turns as real session history. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { buildMergedSessionSeed } from './history.ts'
import {
  CREATE_MERGED_SESSION_COMMAND,
  decodeCreateMergedSessionPayload,
} from './protocol.ts'

export const name = 'dsh-git'
export const inject = ['agents', 'agentPresets', 'commands', 'sessionQuery', 'workspaceRegistry']

/** Repair merge sessions created by versions that copied cwd but forgot Workspace membership. */
async function repairWorkspaceMembership(ctx: Context): Promise<void> {
  const workspaces = ctx.workspaceRegistry.list()
  const grouped = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
  const records = await ctx.sessionQuery.listSessions()
  for (const record of records) {
    const sessionId = record.header.id
    if (!String(sessionId).startsWith('dsh-git-') || grouped.has(sessionId)) continue
    const parentSession = record.header.parentSession
    if (parentSession === undefined) continue
    const workspace = workspaces.find(candidate => candidate.sessionIds.includes(parentSession))
    if (workspace === undefined) continue
    try {
      await workspace.attachSession(sessionId)
      grouped.add(sessionId)
    } catch (error: unknown) {
      ctx.logger.warn(`failed to restore workspace membership for "${sessionId}": ${String(error)}`)
    }
  }
}

/** Mount the private history-composition command used by the browser half. */
export async function apply(ctx: Context): Promise<void> {
  await repairWorkspaceMembership(ctx)
  ctx.commands.register({
    name: CREATE_MERGED_SESSION_COMMAND,
    description: 'Create a dsh-git branch from selected historical turns',
    recordInput: false,
    handler: async ({ agent, rawInput }) => {
      const payload = decodeCreateMergedSessionPayload(rawInput)
      const targetSessionId = SessionId(payload.targetSessionId)
      if (ctx.agents.get(targetSessionId) !== undefined) {
        throw new Error(`target session "${targetSessionId}" already exists`)
      }
      const seed = await buildMergedSessionSeed(
        targetSessionId,
        payload.sources,
        sourceId => ctx.sessionQuery.readSession(sourceId),
      )
      const sourceWorkspace = ctx.workspaceRegistry.list()
        .find(workspace => workspace.sessionIds.includes(agent.id))
      const preset = resolveSessionPreset(agent.session)
      await ctx.agents.create({
        sessionId: targetSessionId,
        seed,
        meta: {
          ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
          parentSession: agent.id,
          seedLength: seed.length,
          ...(preset === undefined ? {} : { agentPreset: preset }),
        },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
      })
      if (sourceWorkspace !== undefined) await sourceWorkspace.attachSession(targetSessionId)
      return { kind: 'success', text: `created merged session ${targetSessionId}` }
    },
  })
}
