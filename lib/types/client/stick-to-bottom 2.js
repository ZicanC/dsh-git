/** Keep a growing scroll area pinned to its floor while the reader stays there. */
import { useCallback, useEffect, useRef, useState } from 'react';
/** Distance from the floor, in pixels, still counted as being at the bottom. */
const BOTTOM_SLACK = 25;
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
export function useStickToBottom() {
    const scrollRef = useRef(null);
    const columnRef = useRef(null);
    const observerRef = useRef(null);
    const atBottomRef = useRef(true);
    const [atBottom, setAtBottom] = useState(true);
    const scrollToBottom = useCallback(() => {
        const element = scrollRef.current;
        if (element === null)
            return;
        element.scrollTop = element.scrollHeight;
        atBottomRef.current = true;
        setAtBottom(true);
    }, []);
    const observe = useCallback(() => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        const column = columnRef.current;
        const element = scrollRef.current;
        if (column === null || element === null || typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(() => {
            if (atBottomRef.current)
                element.scrollTop = element.scrollHeight;
        });
        observer.observe(column);
        observer.observe(element);
        observerRef.current = observer;
    }, []);
    const attachScroller = useCallback((node) => {
        scrollRef.current = node;
        observe();
    }, [observe]);
    const attachColumn = useCallback((node) => {
        columnRef.current = node;
        observe();
    }, [observe]);
    useEffect(() => () => {
        observerRef.current?.disconnect();
        observerRef.current = null;
    }, []);
    const pinned = useCallback(() => atBottomRef.current, []);
    const onScroll = useCallback((event) => {
        const element = event.currentTarget;
        const next = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK;
        atBottomRef.current = next;
        setAtBottom(next);
    }, []);
    return { attachScroller, attachColumn, atBottom, pinned, scrollToBottom, onScroll };
}
//# sourceMappingURL=stick-to-bottom.js.map