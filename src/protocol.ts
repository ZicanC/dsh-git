import type { MergeLineageSource } from './merge-lineage.ts'

/** One graph node selected as a real historical turn in a new session. */
export interface HistoryTurnSource {
  readonly sourceSessionId: string
  readonly sourceTurn: number
  readonly sourceBoundarySeq: number
}

/** Trusted browser-to-Host request used to create a merged session. */
export interface CreateMergedSessionRequest {
  readonly targetSessionId: string
  readonly sources: readonly HistoryTurnSource[]
}

/** Successful creation acknowledgement returned by the Host. */
export interface CreateMergedSessionResponse {
  readonly targetSessionId: string
}

/** Generic Connection channel and endpoint used by the project graph reader. */
export const PROJECT_GRAPH_RPC_CHANNEL = '/dsh-git'
export const PROJECT_GRAPH_RPC_ENDPOINT = 'workspace/graph'
export const HISTORY_PREVIEW_RPC_ENDPOINT = 'history/preview'
export const CREATE_MERGED_SESSION_RPC_ENDPOINT = 'session/create-merged'

/** Practical upper bound for one merged context while retaining full-session defaults. */
export const MAX_MERGED_HISTORY_TURNS = 512

/** Endpoints backing the Host-owned graph ledger. */
export const GRAPH_READ_ENDPOINT = 'graph/read'
export const GRAPH_WRITE_ENDPOINT = 'graph/write'

/** Browser request for an ordered preview of selected historical turns. */
export interface HistoryPreviewRequest {
  readonly sources: readonly HistoryTurnSource[]
}

/** Lossless JSON vocabulary allowed across the private preview RPC. */
export type HistoryPreviewJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly HistoryPreviewJsonValue[]
  | { readonly [key: string]: HistoryPreviewJsonValue }

/** Serializable image reference retained from a user or assistant message. */
export interface HistoryPreviewImageAttachment {
  readonly attachmentId: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** Provider-neutral message content used by the read-only chat preview. */
export type HistoryPreviewContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: HistoryPreviewImageAttachment }
  | {
      readonly type: 'tool-call'
      readonly callId: string
      readonly name: string
      readonly arguments: string
    }
  | {
      readonly type: 'tool-result'
      readonly callId: string
      readonly content: readonly HistoryPreviewContentBlock[]
      readonly isError: boolean
    }
  | {
      readonly type: 'other'
      readonly originalType: string
      readonly value: HistoryPreviewJsonValue
    }

/** One displayable record in a selected turn, ordered by its merged-seed seq. */
export type HistoryPreviewRecord =
  | {
      readonly kind: 'user'
      readonly seq: number
      readonly messageId: string
      readonly content: readonly HistoryPreviewContentBlock[]
      readonly source: HistoryPreviewJsonValue
    }
  | {
      readonly kind: 'assistant'
      readonly seq: number
      readonly step: number
      readonly messageId: string
      readonly blocks: readonly HistoryPreviewContentBlock[]
      readonly provenance: { readonly provider: string; readonly model: string }
      readonly usage?: HistoryPreviewJsonValue
    }
  | {
      readonly kind: 'tool-call'
      readonly seq: number
      readonly step: number
      readonly callId: string
      readonly name: string
      readonly arguments: string
    }
  | {
      readonly kind: 'tool-result'
      readonly seq: number
      readonly step: number
      readonly callId: string
      readonly content: readonly HistoryPreviewContentBlock[]
      readonly isError: boolean
      readonly error?: { readonly name: string; readonly code: string }
      readonly meta?: HistoryPreviewJsonValue
    }
  | {
      readonly kind: 'request'
      readonly seq: number
      readonly requestKind: 'header' | 'context'
      readonly data: HistoryPreviewJsonValue
    }
  | {
      readonly kind: 'turn-status'
      readonly seq: number
      readonly status: string
      readonly details: HistoryPreviewJsonValue
    }
  | {
      readonly kind: 'event'
      readonly seq: number
      readonly eventType: string
      readonly data: HistoryPreviewJsonValue
    }

/** One source PA projected at the target turn it will occupy after Merge. */
export interface HistoryPreviewTurnDTO {
  readonly source: HistoryTurnSource
  readonly targetTurn: number
  readonly records: readonly HistoryPreviewRecord[]
}

/** Complete ordered history preview returned by the Host. */
export interface HistoryPreviewResponse {
  readonly turns: readonly HistoryPreviewTurnDTO[]
}

/** Browser request for one scope's stored ledger. */
export interface GraphReadRequest {
  readonly scopeId: string
}

/** Stored ledger for one scope; `null` before the scope's first write. */
export interface GraphReadResponse {
  readonly scopeId: string
  readonly state: unknown | null
}

/** Browser request replacing one scope's stored ledger. */
export interface GraphWriteRequest {
  readonly scopeId: string
  readonly state: unknown
}

/** Browser request for the complete completed-turn history of one Workspace. */
export interface ProjectGraphRequest {
  readonly workspaceId: string
}

/** One completed Prompt + Answer turn returned by the Host. */
export interface ProjectTurnDTO {
  readonly turn: number
  readonly prompt: string
  readonly answer: string
  readonly startedAt: number
  readonly completedAt: number
  readonly boundarySeq: number
  readonly inherited: boolean
  readonly fingerprint: string
}

/** One Workspace member Session and its completed turns. */
export interface ProjectSessionDTO {
  readonly sessionId: string
  readonly createdAt: number
  readonly parentSessionId?: string
  readonly seedLength: number
  /** Present only on dsh-git merge branches; recovered from the seed lineage event. */
  readonly mergeSources?: readonly MergeLineageSource[]
  readonly turns: readonly ProjectTurnDTO[]
}

/** Complete read-only history used to assemble one project graph. */
export interface ProjectGraphResponse {
  readonly workspaceId: string
  readonly sessions: readonly ProjectSessionDTO[]
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(value).find(key => !allowedKeys.has(key))
  if (unexpected !== undefined) throw new Error(`${label} contains unexpected field "${unexpected}"`)
}

function nonBlank(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-blank string`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`)
  return value as number
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label)
  if (parsed < 1) throw new Error(`${label} must be positive`)
  return parsed
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
  return value
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function jsonValue(value: unknown, label: string): HistoryPreviewJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite JSON numbers`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${label}[${index}]`))
  if (typeof value !== 'object') throw new Error(`${label} must be JSON-serializable`)
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${label} must not contain symbol keys`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${label}.${key}`)]))
}

function decodeHistoryTurnSource(value: unknown, label: string): HistoryTurnSource {
  const source = object(value, label)
  return {
    sourceSessionId: nonBlank(source.sourceSessionId, `${label} sourceSessionId`),
    sourceTurn: positiveInteger(source.sourceTurn, `${label} sourceTurn`),
    sourceBoundarySeq: nonNegativeInteger(source.sourceBoundarySeq, `${label} sourceBoundarySeq`),
  }
}

function decodeHistoryTurnSources(value: unknown, label: string): readonly HistoryTurnSource[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MERGED_HISTORY_TURNS) {
    throw new Error(`${label} requires 1 to ${MAX_MERGED_HISTORY_TURNS} source turns`)
  }
  return value.map((source, index) => decodeHistoryTurnSource(source, `${label} source ${index + 1}`))
}

function decodeImageAttachment(value: unknown, label: string): HistoryPreviewImageAttachment {
  const attachment = object(value, label)
  const mediaType = attachment.mediaType
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg'
    && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
    throw new Error(`${label} mediaType is invalid`)
  }
  return {
    attachmentId: nonBlank(attachment.attachmentId, `${label} attachmentId`),
    mediaType,
    bytes: nonNegativeInteger(attachment.bytes, `${label} bytes`),
    width: positiveInteger(attachment.width, `${label} width`),
    height: positiveInteger(attachment.height, `${label} height`),
    ...(attachment.name === undefined ? {} : { name: string(attachment.name, `${label} name`) }),
  }
}

function decodeHistoryPreviewBlock(value: unknown, label: string): HistoryPreviewContentBlock {
  const block = object(value, label)
  const type = nonBlank(block.type, `${label} type`)
  switch (type) {
    case 'text':
    case 'reasoning':
      if (typeof block.text !== 'string') throw new Error(`${label} text must be a string`)
      return { type, text: block.text }
    case 'image':
      return { type, attachment: decodeImageAttachment(block.attachment, `${label} attachment`) }
    case 'tool-call':
      if (typeof block.arguments !== 'string') throw new Error(`${label} arguments must be a string`)
      return {
        type,
        callId: nonBlank(block.callId, `${label} callId`),
        name: nonBlank(block.name, `${label} name`),
        arguments: block.arguments,
      }
    case 'tool-result': {
      if (!Array.isArray(block.content)) throw new Error(`${label} content must be an array`)
      return {
        type,
        callId: nonBlank(block.callId, `${label} callId`),
        content: block.content.map((item, index) => decodeHistoryPreviewBlock(item, `${label} content ${index + 1}`)),
        isError: boolean(block.isError, `${label} isError`),
      }
    }
    case 'other':
      return {
        type,
        originalType: nonBlank(block.originalType, `${label} originalType`),
        value: jsonValue(block.value, `${label} value`),
      }
    default:
      throw new Error(`${label} has unknown type "${type}"`)
  }
}

function decodeHistoryPreviewBlocks(value: unknown, label: string): readonly HistoryPreviewContentBlock[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((block, index) => decodeHistoryPreviewBlock(block, `${label} block ${index + 1}`))
}

function decodeHistoryPreviewRecord(value: unknown, label: string): HistoryPreviewRecord {
  const record = object(value, label)
  const kind = nonBlank(record.kind, `${label} kind`)
  const seq = nonNegativeInteger(record.seq, `${label} seq`)
  switch (kind) {
    case 'user':
      return {
        kind,
        seq,
        messageId: nonBlank(record.messageId, `${label} messageId`),
        content: decodeHistoryPreviewBlocks(record.content, `${label} content`),
        source: jsonValue(record.source, `${label} source`),
      }
    case 'assistant': {
      const provenance = object(record.provenance, `${label} provenance`)
      return {
        kind,
        seq,
        step: nonNegativeInteger(record.step, `${label} step`),
        messageId: nonBlank(record.messageId, `${label} messageId`),
        blocks: decodeHistoryPreviewBlocks(record.blocks, `${label} blocks`),
        provenance: {
          provider: nonBlank(provenance.provider, `${label} provenance provider`),
          model: nonBlank(provenance.model, `${label} provenance model`),
        },
        ...(record.usage === undefined ? {} : { usage: jsonValue(record.usage, `${label} usage`) }),
      }
    }
    case 'tool-call':
      if (typeof record.arguments !== 'string') throw new Error(`${label} arguments must be a string`)
      return {
        kind,
        seq,
        step: nonNegativeInteger(record.step, `${label} step`),
        callId: nonBlank(record.callId, `${label} callId`),
        name: nonBlank(record.name, `${label} name`),
        arguments: record.arguments,
      }
    case 'tool-result': {
      const error = record.error === undefined ? undefined : object(record.error, `${label} error`)
      return {
        kind,
        seq,
        step: nonNegativeInteger(record.step, `${label} step`),
        callId: nonBlank(record.callId, `${label} callId`),
        content: decodeHistoryPreviewBlocks(record.content, `${label} content`),
        isError: boolean(record.isError, `${label} isError`),
        ...(error === undefined ? {} : { error: {
          name: nonBlank(error.name, `${label} error name`),
          code: nonBlank(error.code, `${label} error code`),
        } }),
        ...(record.meta === undefined ? {} : { meta: jsonValue(record.meta, `${label} meta`) }),
      }
    }
    case 'request':
      if (record.requestKind !== 'header' && record.requestKind !== 'context') {
        throw new Error(`${label} requestKind is invalid`)
      }
      return { kind, seq, requestKind: record.requestKind, data: jsonValue(record.data, `${label} data`) }
    case 'turn-status':
      return {
        kind,
        seq,
        status: nonBlank(record.status, `${label} status`),
        details: jsonValue(record.details, `${label} details`),
      }
    case 'event':
      return {
        kind,
        seq,
        eventType: nonBlank(record.eventType, `${label} eventType`),
        data: jsonValue(record.data, `${label} data`),
      }
    default:
      throw new Error(`${label} has unknown kind "${kind}"`)
  }
}

/** Strictly validate an untrusted ordered history-preview request. */
export function decodeHistoryPreviewRequest(value: unknown): HistoryPreviewRequest {
  const candidate = object(value, 'dsh-git history preview request')
  return { sources: decodeHistoryTurnSources(candidate.sources, 'dsh-git history preview request') }
}

/** Strictly validate the full Host history projection received across Connection. */
export function decodeHistoryPreviewResponse(value: unknown): HistoryPreviewResponse {
  const candidate = object(value, 'dsh-git history preview response')
  if (!Array.isArray(candidate.turns)
    || candidate.turns.length === 0
    || candidate.turns.length > MAX_MERGED_HISTORY_TURNS) {
    throw new Error(`dsh-git history preview response requires 1 to ${MAX_MERGED_HISTORY_TURNS} turns`)
  }
  const turns = candidate.turns.map((rawTurn, index): HistoryPreviewTurnDTO => {
    const label = `dsh-git history preview response turn ${index + 1}`
    const turn = object(rawTurn, label)
    const targetTurn = positiveInteger(turn.targetTurn, `${label} targetTurn`)
    if (targetTurn !== index + 1) throw new Error(`${label} targetTurn must preserve source order`)
    if (!Array.isArray(turn.records)) throw new Error(`${label} records must be an array`)
    const records = turn.records.map((record, recordIndex) =>
      decodeHistoryPreviewRecord(record, `${label} record ${recordIndex + 1}`))
    for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
      if (records[recordIndex]!.seq <= records[recordIndex - 1]!.seq) {
        throw new Error(`${label} records must have ascending seq values`)
      }
    }
    return {
      source: decodeHistoryTurnSource(turn.source, `${label} source`),
      targetTurn,
      records,
    }
  })
  return { turns }
}

/** Strictly validate the trusted RPC request before creating any Host state. */
export function decodeCreateMergedSessionRequest(value: unknown): CreateMergedSessionRequest {
  const label = 'dsh-git create merged session request'
  const candidate = object(value, label)
  exactKeys(candidate, ['targetSessionId', 'sources'], label)
  const sources = decodeHistoryTurnSources(candidate.sources, label)
  const rawSources = candidate.sources as readonly unknown[]
  rawSources.forEach((source, index) => {
    const sourceLabel = `${label} source ${index + 1}`
    exactKeys(object(source, sourceLabel), [
      'sourceSessionId', 'sourceTurn', 'sourceBoundarySeq',
    ], sourceLabel)
  })
  return {
    targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`),
    sources,
  }
}

/** Strictly validate the Host acknowledgement received across Connection. */
export function decodeCreateMergedSessionResponse(value: unknown): CreateMergedSessionResponse {
  const label = 'dsh-git create merged session response'
  const candidate = object(value, label)
  exactKeys(candidate, ['targetSessionId'], label)
  return { targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`) }
}

/** Strictly validate the untrusted project graph RPC request. */
export function decodeProjectGraphRequest(value: unknown): ProjectGraphRequest {
  const candidate = object(value, 'dsh-git project graph request')
  return { workspaceId: nonBlank(candidate.workspaceId, 'workspaceId') }
}

/** Validate seed-recovered merge lineage arriving across Connection. */
function decodeMergeSources(value: unknown, label: string): readonly MergeLineageSource[] {
  if (!Array.isArray(value)) throw new Error(`${label} mergeSources must be an array`)
  return value.map((raw, index): MergeLineageSource => {
    const source = object(raw, `${label} mergeSource ${index + 1}`)
    const positive = (candidate: unknown, field: string): number => {
      const parsed = nonNegativeInteger(candidate, `${label} mergeSource ${index + 1} ${field}`)
      if (parsed < 1) throw new Error(`${label} mergeSource ${index + 1} ${field} must be positive`)
      return parsed
    }
    return {
      sourceSessionId: nonBlank(source.sourceSessionId, `${label} mergeSource ${index + 1} sourceSessionId`),
      sourceTurn: positive(source.sourceTurn, 'sourceTurn'),
      sourceBoundarySeq: nonNegativeInteger(
        source.sourceBoundarySeq,
        `${label} mergeSource ${index + 1} sourceBoundarySeq`,
      ),
      targetTurn: positive(source.targetTurn, 'targetTurn'),
    }
  })
}

/** Validate the ledger-read request; the state schema is enforced by the Host domain. */
export function decodeGraphReadRequest(value: unknown): GraphReadRequest {
  const candidate = object(value, 'dsh-git graph read request')
  return { scopeId: nonBlank(candidate.scopeId, 'scopeId') }
}

/** Validate the ledger-read response envelope received across Connection. */
export function decodeGraphReadResponse(value: unknown): GraphReadResponse {
  const candidate = object(value, 'dsh-git graph read response')
  const state = candidate.state
  if (state !== null && (typeof state !== 'object' || Array.isArray(state))) {
    throw new Error('dsh-git graph read response state must be an object or null')
  }
  return { scopeId: nonBlank(candidate.scopeId, 'scopeId'), state }
}

/** Validate the ledger-write envelope; `state` is parsed against the domain schema. */
export function decodeGraphWriteRequest(value: unknown): GraphWriteRequest {
  const candidate = object(value, 'dsh-git graph write request')
  const state = object(candidate.state, 'dsh-git graph write request state')
  return { scopeId: nonBlank(candidate.scopeId, 'scopeId'), state }
}

/** Strictly validate the project graph response received across Connection. */
export function decodeProjectGraphResponse(value: unknown): ProjectGraphResponse {
  const candidate = object(value, 'dsh-git project graph response')
  const workspaceId = nonBlank(candidate.workspaceId, 'workspaceId')
  if (!Array.isArray(candidate.sessions)) throw new Error('sessions must be an array')
  const sessions = candidate.sessions.map((rawSession, sessionIndex): ProjectSessionDTO => {
    const session = object(rawSession, `session ${sessionIndex + 1}`)
    const sessionId = nonBlank(session.sessionId, `session ${sessionIndex + 1} sessionId`)
    const createdAt = nonNegativeInteger(session.createdAt, `session ${sessionIndex + 1} createdAt`)
    const seedLength = nonNegativeInteger(session.seedLength, `session ${sessionIndex + 1} seedLength`)
    const parentSessionId = session.parentSessionId === undefined
      ? undefined
      : nonBlank(session.parentSessionId, `session ${sessionIndex + 1} parentSessionId`)
    if (!Array.isArray(session.turns)) throw new Error(`session ${sessionIndex + 1} turns must be an array`)
    const turns = session.turns.map((rawTurn, turnIndex): ProjectTurnDTO => {
      const turn = object(rawTurn, `session ${sessionIndex + 1} turn ${turnIndex + 1}`)
      const turnNumber = nonNegativeInteger(turn.turn, `session ${sessionIndex + 1} turn number`)
      if (turnNumber < 1) throw new Error(`session ${sessionIndex + 1} turn number must be positive`)
      if (typeof turn.prompt !== 'string' || typeof turn.answer !== 'string') {
        throw new Error(`session ${sessionIndex + 1} turn ${turnIndex + 1} text must be strings`)
      }
      if (typeof turn.inherited !== 'boolean') {
        throw new Error(`session ${sessionIndex + 1} turn ${turnIndex + 1} inherited must be boolean`)
      }
      return {
        turn: turnNumber,
        prompt: turn.prompt,
        answer: turn.answer,
        startedAt: nonNegativeInteger(turn.startedAt, `session ${sessionIndex + 1} turn ${turnIndex + 1} startedAt`),
        completedAt: nonNegativeInteger(turn.completedAt, `session ${sessionIndex + 1} turn ${turnIndex + 1} completedAt`),
        boundarySeq: nonNegativeInteger(turn.boundarySeq, `session ${sessionIndex + 1} turn ${turnIndex + 1} boundarySeq`),
        inherited: turn.inherited,
        fingerprint: nonBlank(turn.fingerprint, `session ${sessionIndex + 1} turn ${turnIndex + 1} fingerprint`),
      }
    })
    const mergeSources = session.mergeSources === undefined
      ? undefined
      : decodeMergeSources(session.mergeSources, `session ${sessionIndex + 1}`)
    return {
      sessionId,
      createdAt,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
      seedLength,
      ...(mergeSources === undefined ? {} : { mergeSources }),
      turns,
    }
  })
  return { workspaceId, sessions }
}
