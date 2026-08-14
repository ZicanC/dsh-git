/** Host-side projection of complete Session logs into project graph PA records. */
import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import type { ProjectSessionDTO, ProjectTurnDTO } from './protocol.ts'

interface TextBlock {
  readonly type?: unknown
  readonly text?: unknown
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((block) => {
    const candidate = block as TextBlock
    return candidate.type === 'text' && typeof candidate.text === 'string' ? [candidate.text] : []
  }).join('\n')
}

function userText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  return contentText((event.data as { content?: unknown }).content)
}

function assistantText(event: SessionEvent): string | undefined {
  if (event.type !== 'assistant/message') return undefined
  const message = (event.data as { message?: { content?: unknown } }).message
  return contentText(message?.content)
}

function fingerprint(events: readonly SessionEvent[]): string {
  const material = events.flatMap((event) => {
    const user = userText(event)
    if (user !== undefined) return [{ type: 'user', text: user }]
    const assistant = assistantText(event)
    if (assistant !== undefined) return [{ type: 'assistant', text: assistant }]
    return []
  })
  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

/** Extract only balanced, completed, non-empty PA turns from one complete Session log. */
export function projectTurns(snapshot: SessionLogSnapshot): readonly ProjectTurnDTO[] {
  const turns: ProjectTurnDTO[] = []
  const starts = new Map<number, SessionEvent & { type: 'turn/start' }>()
  for (const event of snapshot.events) {
    if (event.type === 'turn/start') {
      starts.set(event.data.turn, event)
      continue
    }
    if (event.type !== 'turn/end') continue
    const start = starts.get(event.data.turn)
    if (start === undefined || start.seq >= event.seq) continue
    const events = snapshot.events.slice(start.seq + 1, event.seq)
    const prompt = events.flatMap(candidate => userText(candidate) ?? []).filter(Boolean).join('\n')
    const answer = events.flatMap(candidate => assistantText(candidate) ?? []).filter(Boolean).join('\n\n')
    if (prompt === '' && answer === '') continue
    turns.push({
      turn: event.data.turn,
      prompt,
      answer,
      startedAt: start.time,
      completedAt: event.time,
      boundarySeq: event.seq,
      inherited: event.seq < (snapshot.session.seedLength ?? 0),
      fingerprint: fingerprint(events),
    })
  }
  return turns.sort((left, right) => left.turn - right.turn)
}

/** Convert one complete Session snapshot into the project graph wire record. */
export function projectSession(snapshot: SessionLogSnapshot): ProjectSessionDTO {
  return {
    sessionId: snapshot.session.id,
    createdAt: snapshot.session.createdAt,
    ...(snapshot.session.parentSession === undefined ? {} : { parentSessionId: snapshot.session.parentSession }),
    seedLength: snapshot.session.seedLength ?? 0,
    turns: projectTurns(snapshot),
  }
}
