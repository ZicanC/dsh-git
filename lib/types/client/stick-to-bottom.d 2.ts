/** Keep a growing scroll area pinned to its floor while the reader stays there. */
import { type UIEvent } from 'react';
/** Ref callbacks, state, and handlers for one pinned scroll area. */
export interface StickToBottom {
    /** Ref callback for the scrolling element. */
    readonly attachScroller: (node: HTMLDivElement | null) => void;
    /** Ref callback for the content column whose growth is followed. */
    readonly attachColumn: (node: HTMLDivElement | null) => void;
    /** Whether the reader is at the floor, as of the last render. */
    readonly atBottom: boolean;
    /** Whether the reader is at the floor right now, for use inside effects. */
    readonly pinned: () => boolean;
    readonly scrollToBottom: () => void;
    readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
}
/**
 * Follow content that grows below the render cadence.
 *
 * Streaming extends the column token by token, which no prop-keyed effect can
 * see, so the measured column is followed instead — and only while the reader
 * is still at the floor.
 *
 * The observer is attached from the ref callbacks, not from a mount effect:
 * the scroller and the column may enter the tree long after the owning
 * component mounted, and an effect that ran once at mount would observe
 * nothing and never run again.
 */
export declare function useStickToBottom(): StickToBottom;
