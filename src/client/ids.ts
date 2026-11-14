/** Random suffix for ids the browser mints: ledger nodes, branches, and child Sessions. */
export function randomSuffix(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
