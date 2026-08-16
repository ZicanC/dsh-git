import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import { buildMergedSessionSeed } from './history.ts'
import {
  decodeHistoryPreviewResponse,
  type HistoryPreviewContentBlock,
  type HistoryPreviewJsonValue,
  type HistoryPreviewRecord,
  type HistoryPreviewResponse,
  type HistoryTurnSource,
} from './protocol.ts'

type SourceContentBlock = SessionEvent<'user/message'>['data']['content'][number]

function projectContentBlock(block: SourceContentBlock): HistoryPreviewContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'reasoning':
      return { type: 'reasoning', text: block.text }
    case 'image':
      return {
        type: 'image',
        attachment: {
          attachmentId: String(block.attachment.attachmentId),
          mediaType: block.attachment.mediaType,
          bytes: block.attachment.bytes,
          width: block.attachment.width,
          height: block.attachment.height,
          ...(block.attachment.name === undefined ? {} : { name: block.attachment.name }),
        },
      }
    case 'tool-call':
      return {
        type: 'tool-call',
        callId: String(block.id),
        name: block.name,
        arguments: block.arguments,
      }
    case 'tool-result':
      return {
        type: 'tool-result',
        callId: String(block.toolCallId),
        content: block.content.map(projectContentBlock),
        isError: block.isError ?? false,
      }
    default:
      return {
        type: 'other',
        originalType: typeof (block as { type?: unknown }).type === 'string'
          ? (block as { type: string }).type
          : 'unknown',
        value: block as unknown as HistoryPreviewJsonValue,
      }
  }
}

function projectEvent(event: SessionEvent): HistoryPreviewRecord | undefined {
  switch (event.type) {
    case 'user/message':
      return {
        kind: 'user',
        seq: event.seq,
        messageId: String(event.data.id),
        content: event.data.content.map(projectContentBlock),
        source: event.data.source as unknown as HistoryPreviewJsonValue,
      }
    case 'assistant/message':
      return {
        kind: 'assistant',
        seq: event.seq,
        step: event.data.step,
        messageId: String(event.data.message.id),
        blocks: event.data.message.content.map(projectContentBlock),
        provenance: {
          provider: event.data.message.source.provider,
          model: event.data.message.source.model,
        },
        ...(event.data.usage === undefined
          ? {}
          : { usage: event.data.usage as unknown as HistoryPreviewJsonValue }),
      }
    case 'tool/call':
      return {
        kind: 'tool-call',
        seq: event.seq,
        step: event.data.step,
        callId: String(event.data.callId),
        name: event.data.name,
        arguments: event.data.arguments,
      }
    case 'tool/result': {
      const block = event.data.message.content[0]
      return {
        kind: 'tool-result',
        seq: event.seq,
        step: event.data.step,
        callId: String(block.toolCallId),
        content: block.content.map(projectContentBlock),
        isError: block.isError ?? false,
        ...(event.data.error === undefined ? {} : { error: event.data.error }),
        ...(event.data.meta === undefined
          ? {}
          : { meta: event.data.meta as unknown as HistoryPreviewJsonValue }),
      }
    }
    case 'request/header':
      return {
        kind: 'request',
        seq: event.seq,
        requestKind: 'header',
        data: event.data as unknown as HistoryPreviewJsonValue,
      }
    case 'request/context':
      return {
        kind: 'request',
        seq: event.seq,
        requestKind: 'context',
        data: event.data as unknown as HistoryPreviewJsonValue,
      }
    case 'turn/end':
      if (event.data.reason.kind === 'completed') return undefined
      return {
        kind: 'turn-status',
        seq: event.seq,
        status: event.data.reason.kind,
        details: event.data.reason as unknown as HistoryPreviewJsonValue,
      }
    case 'turn/start':
    case 'step/start':
    case 'step/end':
    case 'assistant/chunk':
      return undefined
    default:
      return {
        kind: 'event',
        seq: event.seq,
        eventType: event.type,
        data: event.data as unknown as HistoryPreviewJsonValue,
      }
  }
}

function selectedTurnEvents(
  seed: readonly SessionEvent[],
  targetTurn: number,
): readonly SessionEvent[] {
  const startIndex = seed.findIndex(event =>
    event.type === 'turn/start' && event.data.turn === targetTurn)
  if (startIndex < 0) throw new Error(`merged preview seed has no start for target turn ${targetTurn}`)
  const relativeEnd = seed.slice(startIndex + 1).findIndex(event =>
    event.type === 'turn/end' && event.data.turn === targetTurn)
  if (relativeEnd < 0) throw new Error(`merged preview seed has no end for target turn ${targetTurn}`)
  return seed.slice(startIndex + 1, startIndex + relativeEnd + 2)
}

/**
 * Project selected turns through the actual merged-seed builder, so the preview
 * and a later Merge share source validation, event filtering, and tray order.
 */
export async function projectHistoryPreview(
  sources: readonly HistoryTurnSource[],
  readSession: (sessionId: ReturnType<typeof SessionId>) => Promise<SessionLogSnapshot>,
): Promise<HistoryPreviewResponse> {
  const seed = await buildMergedSessionSeed('dsh-git-history-preview', sources, readSession)
  return decodeHistoryPreviewResponse({
    turns: sources.map((source, index) => {
      const targetTurn = index + 1
      return {
        source,
        targetTurn,
        records: selectedTurnEvents(seed, targetTurn).flatMap(event => {
          const record = projectEvent(event)
          return record === undefined ? [] : [record]
        }),
      }
    }),
  })
}
