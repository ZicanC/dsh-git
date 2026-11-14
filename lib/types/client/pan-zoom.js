/** Pan and zoom of the conversation tree inside its viewport. */
import { useCallback, useEffect, useRef, useState, } from 'react';
// Zoom bounds for the pan/zoom stage. Below the floor the labels stop being
// readable; above the ceiling a single node fills the panel.
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2.5;
const ZOOM_STEP = 1.2;
// Breathing room kept around the graph when it is fitted into the viewport.
const FIT_PADDING = 16;
// Keyboard focus must not land on a node parked outside the visible area.
const FOCUS_MARGIN = 12;
function clampScale(scale) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}
/** Center the whole stage in the viewport, never magnifying past 1:1. */
function fitTransform(viewport, stage) {
    if (viewport.width === 0 || viewport.height === 0)
        return { x: 0, y: 0, scale: 1 };
    const usableWidth = Math.max(1, viewport.width - FIT_PADDING * 2);
    const usableHeight = Math.max(1, viewport.height - FIT_PADDING * 2);
    const scale = clampScale(Math.min(1, usableWidth / stage.width, usableHeight / stage.height));
    return {
        scale,
        x: (viewport.width - stage.width * scale) / 2,
        y: (viewport.height - stage.height * scale) / 2,
    };
}
/**
 * Own the stage transform of one viewport.
 *
 * The stage stays centered and fully visible through every resize and layout
 * change until the user pans or zooms it themselves; from then on it is left
 * alone until they ask for the fitted view back.
 * @param stage - unscaled size of the laid-out content; keep its identity
 *   stable between layouts, since a new object re-fits an untouched view.
 * @param mounted - whether the viewport element is in the tree. The listeners
 *   re-bind when it appears, because an empty graph renders no viewport.
 */
export function usePanZoom(stage, mounted) {
    const viewportRef = useRef(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const [panning, setPanning] = useState(false);
    // Once the user drives the canvas themselves, automatic re-centering stops
    // until they ask for it back through the fit control.
    const adjustedRef = useRef(false);
    const panRef = useRef(null);
    const stageRef = useRef(stage);
    stageRef.current = stage;
    useEffect(() => {
        const element = viewportRef.current;
        if (element === null)
            return;
        const update = () => setViewport(current => current.width === element.clientWidth && current.height === element.clientHeight
            ? current
            : { width: element.clientWidth, height: element.clientHeight });
        update();
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [mounted]);
    // Entering the graph — and every later resize or graph change the user has
    // not overridden — lands on a centered, fully visible view.
    useEffect(() => {
        if (adjustedRef.current)
            return;
        if (viewport.width === 0 || viewport.height === 0)
            return;
        setTransform(fitTransform(viewport, stage));
    }, [viewport, stage]);
    /** Zoom around a viewport-relative anchor so the point under it stays put. */
    const zoomBy = useCallback((factor, anchorX, anchorY) => {
        adjustedRef.current = true;
        setTransform((current) => {
            const scale = clampScale(current.scale * factor);
            if (scale === current.scale)
                return current;
            const ratio = scale / current.scale;
            return {
                scale,
                x: anchorX - (anchorX - current.x) * ratio,
                y: anchorY - (anchorY - current.y) * ratio,
            };
        });
    }, []);
    const resetView = useCallback(() => {
        const element = viewportRef.current;
        if (element === null)
            return;
        adjustedRef.current = false;
        setTransform(fitTransform({ width: element.clientWidth, height: element.clientHeight }, stageRef.current));
    }, []);
    // Wheel must be a non-passive native listener: React's synthetic wheel
    // handler cannot cancel the surrounding page scroll.
    useEffect(() => {
        const element = viewportRef.current;
        if (element === null)
            return;
        const onWheel = (event) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
            if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
                const shift = (event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
                adjustedRef.current = true;
                setTransform(current => ({ ...current, x: current.x - shift }));
                return;
            }
            // Trackpad pinch arrives as ctrl+wheel with much smaller deltas.
            const intensity = event.ctrlKey || event.metaKey ? 0.01 : 0.002;
            zoomBy(Math.exp(-event.deltaY * unit * intensity), event.clientX - rect.left, event.clientY - rect.top);
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, [zoomBy, mounted]);
    const startPan = (event) => {
        if (event.button !== 0 && event.button !== 1)
            return;
        // Left-dragging a node is a click on that node, not a canvas pan.
        if (event.button === 0 && event.target.closest('button') !== null)
            return;
        // Middle-drag pans instead of arming the browser's autoscroll ring.
        if (event.button === 1)
            event.preventDefault();
        panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        setPanning(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const continuePan = (event) => {
        const pan = panRef.current;
        if (pan === null || pan.pointerId !== event.pointerId)
            return;
        const dx = event.clientX - pan.x;
        const dy = event.clientY - pan.y;
        panRef.current = { pointerId: pan.pointerId, x: event.clientX, y: event.clientY };
        adjustedRef.current = true;
        setTransform(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
    };
    const endPan = (event) => {
        if (panRef.current?.pointerId !== event.pointerId)
            return;
        panRef.current = null;
        setPanning(false);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
    };
    const reveal = (box) => {
        const element = viewportRef.current;
        if (element === null)
            return;
        setTransform((current) => {
            const left = box.left * current.scale + current.x;
            const top = box.top * current.scale + current.y;
            const right = left + box.width * current.scale;
            const bottom = top + box.height * current.scale;
            const dx = left < FOCUS_MARGIN
                ? FOCUS_MARGIN - left
                : right > element.clientWidth - FOCUS_MARGIN ? element.clientWidth - FOCUS_MARGIN - right : 0;
            const dy = top < FOCUS_MARGIN
                ? FOCUS_MARGIN - top
                : bottom > element.clientHeight - FOCUS_MARGIN ? element.clientHeight - FOCUS_MARGIN - bottom : 0;
            return dx === 0 && dy === 0 ? current : { ...current, x: current.x + dx, y: current.y + dy };
        });
    };
    const zoomAtCenter = (factor) => zoomBy(factor, viewport.width / 2, viewport.height / 2);
    return {
        viewportRef,
        transform,
        panning,
        canZoomIn: transform.scale < MAX_SCALE - 0.001,
        canZoomOut: transform.scale > MIN_SCALE + 0.001,
        zoomIn: () => zoomAtCenter(ZOOM_STEP),
        zoomOut: () => zoomAtCenter(1 / ZOOM_STEP),
        resetView,
        reveal,
        handlers: {
            onPointerDown: startPan,
            onPointerMove: continuePan,
            onPointerUp: endPan,
            onPointerCancel: endPan,
            onDoubleClick: (event) => {
                if (event.target.closest('button') === null)
                    resetView();
            },
        },
    };
}
//# sourceMappingURL=pan-zoom.js.map