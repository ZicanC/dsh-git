import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextTrayProps } from './ContextTray.tsx'

/**
 * Session-local bridge between the active Branches view and the resident
 * composer dock. The publishing view remains the sole owner of tray state.
 */
export class ContextTrayChannel implements HostObservable<ContextTrayProps | null> {
  private snapshot: ContextTrayProps | null = null
  private owner: object | null = null
  private readonly listeners = new Set<() => void>()

  /** Return the same object until a publisher replaces or clears it. */
  getSnapshot = (): ContextTrayProps | null => this.snapshot

  /** Subscribe to published tray-model changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Publish one committed view model and transfer ownership to its token. */
  publish(owner: object, model: ContextTrayProps): void {
    const changed = this.snapshot !== model
    this.owner = owner
    this.snapshot = model
    if (changed) this.emit()
  }

  /**
   * Clear only the model still owned by this token. An obsolete React cleanup
   * must not remove a newer Branches instance's tray.
   */
  clear(owner: object): void {
    if (this.owner !== owner) return
    this.owner = null
    if (this.snapshot === null) return
    this.snapshot = null
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Stable Context Tray channels, isolated by DSH Session identity. */
export class ContextTrayChannels {
  private readonly channels = new Map<string, ContextTrayChannel>()

  forSession(sessionId: string): ContextTrayChannel {
    const existing = this.channels.get(sessionId)
    if (existing !== undefined) return existing
    const channel = new ContextTrayChannel()
    this.channels.set(sessionId, channel)
    return channel
  }
}
