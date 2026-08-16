/**
 * Session-local bridge between the active Branches view and the resident
 * composer dock. The publishing view remains the sole owner of tray state.
 */
export class ContextTrayChannel {
    snapshot = null;
    owner = null;
    listeners = new Set();
    /** Return the same object until a publisher replaces or clears it. */
    getSnapshot = () => this.snapshot;
    /** Subscribe to published tray-model changes. */
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    /** Publish one committed view model and transfer ownership to its token. */
    publish(owner, model) {
        const changed = this.snapshot !== model;
        this.owner = owner;
        this.snapshot = model;
        if (changed)
            this.emit();
    }
    /**
     * Clear only the model still owned by this token. An obsolete React cleanup
     * must not remove a newer Branches instance's tray.
     */
    clear(owner) {
        if (this.owner !== owner)
            return;
        this.owner = null;
        if (this.snapshot === null)
            return;
        this.snapshot = null;
        this.emit();
    }
    emit() {
        for (const listener of this.listeners)
            listener();
    }
}
/** Stable Context Tray channels, isolated by DSH Session identity. */
export class ContextTrayChannels {
    channels = new Map();
    forSession(sessionId) {
        const existing = this.channels.get(sessionId);
        if (existing !== undefined)
            return existing;
        const channel = new ContextTrayChannel();
        this.channels.set(sessionId, channel);
        return channel;
    }
}
//# sourceMappingURL=context-tray-channel.js.map