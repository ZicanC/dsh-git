import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Own only dsh-git's composer block while coexisting with other blockers.
 *
 * The Host registry currently stores one value per Session rather than one
 * value per plugin. This lease never clears a foreign value. While active it
 * watches the slot and reasserts its own block only after another owner has
 * released theirs.
 */
export class ComposerBlockLease {
  private ownedBlock: { readonly reason: string } | undefined
  private stop: (() => void) | undefined
  private desired = false

  constructor(
    private readonly blocks: IConversation['blocks'],
    private readonly sessionId: SessionId,
    private readonly reason: () => string,
  ) {}

  /** Raise or release this owner's block without disturbing a foreign owner. */
  setBlocked(blocked: boolean): boolean {
    if (blocked === this.desired) {
      return this.blocks.storeFor(this.sessionId).getSnapshot() === undefined
    }
    this.desired = blocked
    if (blocked) {
      this.ownedBlock = { reason: this.reason() }
      const store = this.blocks.storeFor(this.sessionId)
      this.stop = store.subscribe(() => { this.reconcile() })
      this.reconcile()
      return false
    }
    this.release()
    return this.blocks.storeFor(this.sessionId).getSnapshot() === undefined
  }

  /** Release this lease and its subscription. */
  dispose(): void {
    this.desired = false
    this.release()
  }

  private reconcile(): void {
    if (!this.desired) return
    const current = this.blocks.storeFor(this.sessionId).getSnapshot()
    if (current === undefined && this.ownedBlock !== undefined) this.blocks.set(this.sessionId, this.ownedBlock)
  }

  private release(): void {
    const stop = this.stop
    this.stop = undefined
    stop?.()
    const current = this.blocks.storeFor(this.sessionId).getSnapshot()
    if (this.ownedBlock !== undefined && current === this.ownedBlock) this.blocks.set(this.sessionId, undefined)
    this.ownedBlock = undefined
  }
}
