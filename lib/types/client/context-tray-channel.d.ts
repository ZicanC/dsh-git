import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { ContextTrayProps } from './ContextTray.tsx';
/**
 * Session-local bridge between the active Branches view and the resident
 * composer dock. The publishing view remains the sole owner of tray state.
 */
export declare class ContextTrayChannel implements HostObservable<ContextTrayProps | null> {
    private snapshot;
    private owner;
    private readonly listeners;
    /** Return the same object until a publisher replaces or clears it. */
    getSnapshot: () => ContextTrayProps | null;
    /** Subscribe to published tray-model changes. */
    subscribe: (listener: () => void) => (() => void);
    /** Publish one committed view model and transfer ownership to its token. */
    publish(owner: object, model: ContextTrayProps): void;
    /**
     * Clear only the model still owned by this token. An obsolete React cleanup
     * must not remove a newer Branches instance's tray.
     */
    clear(owner: object): void;
    private emit;
}
/** Stable Context Tray channels, isolated by DSH Session identity. */
export declare class ContextTrayChannels {
    private readonly channels;
    forSession(sessionId: string): ContextTrayChannel;
}
