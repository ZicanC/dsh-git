/** Records of the selected PAs for Chat History, read from the Host once each. */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_MERGED_HISTORY_TURNS, type HistoryPreviewResponse, type HistoryTurnSource,
} from '../protocol.ts'
import { localized, type Locale } from './i18n.ts'
import { HistoryPreviewCache, previewSourceKey } from './preview-cache.ts'
import type { TurnNodeId } from './types.ts'

/** One selected PA and where the Host reads it from. */
export interface PreviewEntry {
  readonly nodeId: TurnNodeId
  readonly source: HistoryTurnSource
}

/** Chat History for the current selection, as far as it has been read. */
export interface HistoryPreview {
  /** The selection in order; a PA not read yet carries no records. Null for an empty or oversized selection. */
  readonly response: HistoryPreviewResponse | null
  /** Selected PAs whose records have not arrived yet. */
  readonly pendingNodeIds: ReadonlySet<TurnNodeId>
  readonly loading: boolean
  readonly error: string | null
}

/**
 * Keep Chat History in step with the selection.
 *
 * A completed turn is immutable, so its records are cached for the lifetime
 * of the view. Only PAs this view has never read are requested, and a request
 * in flight is never cancelled by a later selection edit: its records stay
 * valid for whatever selection is current when they land. Removing a PA is
 * therefore pure local work, and re-adding one costs no Host round trip.
 * @param entries - the selection in order; keep its identity stable between
 *   renders that do not change it.
 */
export function useHistoryPreview(
  entries: readonly PreviewEntry[],
  load: (sources: readonly HistoryTurnSource[], signal: AbortSignal) => Promise<HistoryPreviewResponse>,
  locale: Locale,
): HistoryPreview {
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cacheRef = useRef(new HistoryPreviewCache())
  const inFlightRef = useRef(new Set<string>())
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const key = entries.map(({ source }) => previewSourceKey(source)).join('|')
  const overLimit = entries.length > MAX_MERGED_HISTORY_TURNS

  useEffect(() => {
    const sources = entries.map(entry => entry.source)
    if (sources.length === 0 || overLimit) {
      setLoading(false)
      setError(overLimit
        ? localized(
          `单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`,
          `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale,
        )
        : null)
      return
    }
    const inFlight = inFlightRef.current
    const missing = cacheRef.current.missing(sources)
      .filter(source => !inFlight.has(previewSourceKey(source)))
    if (missing.length === 0) {
      setLoading(inFlight.size > 0)
      if (inFlight.size === 0) setError(null)
      return
    }
    abortRef.current ??= new AbortController()
    const signal = abortRef.current.signal
    const keys = missing.map(previewSourceKey)
    for (const missingKey of keys) inFlight.add(missingKey)
    setLoading(true)
    setError(null)
    void load(missing, signal).then((response) => {
      if (signal.aborted) return
      cacheRef.current.absorb(response)
      setRevision(current => current + 1)
    }).catch((cause: unknown) => {
      if (signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      for (const missingKey of keys) inFlight.delete(missingKey)
      if (!signal.aborted) setLoading(inFlight.size > 0)
    })
  }, [key, overLimit, load, locale])

  const response = useMemo<HistoryPreviewResponse | null>(() => {
    if (entries.length === 0 || overLimit) return null
    return cacheRef.current.assemble(entries.map(entry => entry.source))
    // `revision` republishes the assembly after a Host read lands.
  }, [entries, overLimit, revision])
  const pendingNodeIds = useMemo(() => new Set(entries.flatMap(entry =>
    cacheRef.current.has(entry.source) ? [] : [entry.nodeId])),
  [entries, revision])

  return { response, pendingNodeIds, loading, error }
}
