/** Runtime invariant companion for the host-empty, browser-only plugin. */
export const name = 'dsh-git-invariant'

/** No host invariant: all state and effects are owned by the browser plugin. */
export function apply(): void {}
