/**
 * Own only dsh-git's composer block while coexisting with other blockers.
 *
 * The Host registry currently stores one value per Session rather than one
 * value per plugin. This lease never clears a foreign value. While active it
 * watches the slot and reasserts its own block only after another owner has
 * released theirs.
 */
export class ComposerBlockLease {
    blocks;
    sessionId;
    reason;
    ownedBlock;
    stop;
    desired = false;
    constructor(blocks, sessionId, reason) {
        this.blocks = blocks;
        this.sessionId = sessionId;
        this.reason = reason;
    }
    /** Raise or release this owner's block without disturbing a foreign owner. */
    setBlocked(blocked) {
        if (blocked === this.desired) {
            return this.blocks.storeFor(this.sessionId).getSnapshot() === undefined;
        }
        this.desired = blocked;
        if (blocked) {
            this.ownedBlock = { reason: this.reason() };
            const store = this.blocks.storeFor(this.sessionId);
            this.stop = store.subscribe(() => { this.reconcile(); });
            this.reconcile();
            return false;
        }
        this.release();
        return this.blocks.storeFor(this.sessionId).getSnapshot() === undefined;
    }
    /** Release this lease and its subscription. */
    dispose() {
        this.desired = false;
        this.release();
    }
    reconcile() {
        if (!this.desired)
            return;
        const current = this.blocks.storeFor(this.sessionId).getSnapshot();
        if (current === undefined && this.ownedBlock !== undefined)
            this.blocks.set(this.sessionId, this.ownedBlock);
    }
    release() {
        const stop = this.stop;
        this.stop = undefined;
        stop?.();
        const current = this.blocks.storeFor(this.sessionId).getSnapshot();
        if (this.ownedBlock !== undefined && current === this.ownedBlock)
            this.blocks.set(this.sessionId, undefined);
        this.ownedBlock = undefined;
    }
}
//# sourceMappingURL=composer-block-lease.js.map