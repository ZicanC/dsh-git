/**
 * Text projections for the Chat History preview: one-line summaries, readable
 * tool arguments, and the provenance of an injected context message. Pure, so
 * the row components in `./PreviewRecords.tsx` stay markup.
 */
import type { HistoryPreviewContentBlock, HistoryPreviewJsonValue } from '../protocol.ts'

export function json(value: HistoryPreviewJsonValue): string {
  try { return JSON.stringify(value, null, 2) }
  catch { return String(value) }
}

export function oneLine(value: string, maximum = 180): string {
  const line = value.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line.length <= maximum ? line : `${line.slice(0, maximum - 1)}…`
}

export function sourceKind(source: HistoryPreviewJsonValue): string | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null
  const record = source as { readonly [key: string]: HistoryPreviewJsonValue }
  return typeof record.kind === 'string' ? record.kind : null
}

function sourceRecord(value: HistoryPreviewJsonValue): { readonly [key: string]: HistoryPreviewJsonValue } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as { readonly [key: string]: HistoryPreviewJsonValue }
}

function sourceString(record: { readonly [key: string]: HistoryPreviewJsonValue }, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** Same durable-source projection used by the official Context Injection row. */
export function previewContextProvenance(source: HistoryPreviewJsonValue): { role: 'inject' | 'recall'; label: string | null } {
  const record = sourceRecord(source)
  if (record === null) return { role: 'inject', label: null }
  const kind = sourceString(record, 'kind')
  if (kind === null) return { role: 'inject', label: null }
  const collect = (member: string, field: string): string[] => {
    const entries = record[member]
    if (!Array.isArray(entries)) return []
    const values: string[] = []
    for (const entry of entries) {
      const item = sourceRecord(entry)
      const value = item === null ? null : sourceString(item, field)
      if (value !== null && !values.includes(value)) values.push(value)
    }
    return values
  }
  if (kind === 'session-reference') {
    const labels = collect('references', 'label')
    return { role: 'recall', label: labels.length === 0 ? kind : labels.join(', ') }
  }
  if (kind === 'agent-instructions') {
    const paths = collect('changes', 'path')
    return { role: 'inject', label: paths.length === 0 ? kind : paths.join(', ') }
  }
  if (kind === 'plugin') return { role: 'inject', label: sourceString(record, 'plugin') ?? kind }
  if (kind === 'skill-invocation') return { role: 'inject', label: sourceString(record, 'name') ?? kind }
  return { role: 'inject', label: kind }
}

export function firstBlockText(blocks: readonly HistoryPreviewContentBlock[]): string {
  for (const block of blocks) {
    if ((block.type === 'text' || block.type === 'reasoning') && block.text.trim() !== '') return oneLine(block.text)
    if (block.type === 'tool-result') {
      const nested = firstBlockText(block.content)
      if (nested !== '') return nested
    }
  }
  return ''
}

export function argumentSummary(argumentsText: string): string {
  try {
    const parsed = JSON.parse(argumentsText) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return oneLine(String(parsed))
    const record = parsed as Record<string, unknown>
    for (const key of ['description', 'path', 'file_path', 'command', 'query', 'pattern', 'url', 'name']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') return oneLine(value)
    }
  } catch {
    // Tool arguments are producer-owned; malformed JSON stays readable as text.
  }
  return oneLine(argumentsText)
}

export function formattedArguments(argumentsText: string): string {
  try { return JSON.stringify(JSON.parse(argumentsText), null, 2) }
  catch { return argumentsText }
}
