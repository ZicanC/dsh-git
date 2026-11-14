/** Random suffix for ids the browser mints: ledger nodes, branches, and child Sessions. */
export function randomSuffix() {
    return globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
//# sourceMappingURL=ids.js.map