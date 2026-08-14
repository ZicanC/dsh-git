/** One graph node selected as a real historical turn in a new session. */
export interface HistoryTurnSource {
  readonly sourceSessionId: string
  readonly sourceTurn: number
  readonly sourceBoundarySeq: number
}

/** Private browser-to-Host command payload used to create a merged session. */
export interface CreateMergedSessionPayload {
  readonly targetSessionId: string
  readonly sources: readonly HistoryTurnSource[]
}

export const CREATE_MERGED_SESSION_COMMAND = 'dsh-git-create-merged-session'

/** Encode the small JSON payload without exposing selected conversation text in the command log. */
export function encodeCreateMergedSessionPayload(payload: CreateMergedSessionPayload): string {
  return encodeURIComponent(JSON.stringify(payload))
}

/** Decode and strictly validate an untrusted slash-command payload. */
export function decodeCreateMergedSessionPayload(rawInput: string): CreateMergedSessionPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(rawInput.trim()))
  } catch {
    throw new Error('dsh-git merge payload is not valid encoded JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('dsh-git merge payload must be an object')
  }
  const candidate = parsed as { targetSessionId?: unknown; sources?: unknown }
  if (typeof candidate.targetSessionId !== 'string' || candidate.targetSessionId.trim() === '') {
    throw new Error('dsh-git merge payload requires targetSessionId')
  }
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0 || candidate.sources.length > 64) {
    throw new Error('dsh-git merge payload requires 1 to 64 source turns')
  }
  const sources = candidate.sources.map((source, index): HistoryTurnSource => {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) {
      throw new Error(`dsh-git source ${index + 1} must be an object`)
    }
    const value = source as Record<string, unknown>
    if (typeof value.sourceSessionId !== 'string' || value.sourceSessionId.trim() === '') {
      throw new Error(`dsh-git source ${index + 1} requires sourceSessionId`)
    }
    if (!Number.isSafeInteger(value.sourceTurn) || (value.sourceTurn as number) < 1) {
      throw new Error(`dsh-git source ${index + 1} has an invalid sourceTurn`)
    }
    if (!Number.isSafeInteger(value.sourceBoundarySeq) || (value.sourceBoundarySeq as number) < 0) {
      throw new Error(`dsh-git source ${index + 1} has an invalid sourceBoundarySeq`)
    }
    return {
      sourceSessionId: value.sourceSessionId,
      sourceTurn: value.sourceTurn as number,
      sourceBoundarySeq: value.sourceBoundarySeq as number,
    }
  })
  return { targetSessionId: candidate.targetSessionId, sources }
}
