/** Pan and zoom of the conversation tree inside its viewport. */
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
export declare const MIN_SCALE = 0.25;
export declare const MAX_SCALE = 2.5;
interface Viewport {
    readonly width: number;
    readonly height: number;
}
/** Stage transform in viewport pixels: translate first, then scale. */
export interface Transform {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
}
/** A rectangle in unscaled stage coordinates. */
export interface StageBox {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}
/** What the canvas needs to render and drive a pannable, zoomable stage. */
export interface PanZoom {
    readonly viewportRef: RefObject<HTMLDivElement>;
    readonly transform: Transform;
    readonly panning: boolean;
    readonly canZoomIn: boolean;
    readonly canZoomOut: boolean;
    /** Zoom one step around the viewport's center. */
    readonly zoomIn: () => void;
    readonly zoomOut: () => void;
    /** Center and fit the stage, and resume following later layout changes. */
    readonly resetView: () => void;
    /** Pan just enough to bring a stage rectangle inside the viewport. */
    readonly reveal: (box: StageBox) => void;
    /** Pointer and double-click handlers for the viewport element. */
    readonly handlers: {
        readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
        readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
        readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
        readonly onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
        readonly onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
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
export declare function usePanZoom(stage: Viewport, mounted: boolean): PanZoom;
export {};
