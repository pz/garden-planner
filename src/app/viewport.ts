import type { Point } from '../core/geometry';
import type { Bounds } from '../core/layout';

/** The planting view's fixed scale, and the layout editor's 100% zoom. */
export const PLANTING_PX_PER_INCH = 7;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 16;
/** Screen offset from the viewport's top-left of a garden point; the inverse of screenToGarden. */
export function gardenToScreen(view: View, p: Point): Point {
  return { x: (p.x - view.x) * view.zoom, y: (p.y - view.y) * view.zoom };
}
/**
 * The editor's camera: `zoom` screen pixels per inch, and (x, y) the garden point at the
 * viewport's top-left corner.
 */
export interface View {
  zoom: number;
  x: number;
  y: number;
}
export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}
/** Garden point under screen offset (sx, sy) from the viewport's top-left. */
export function screenToGarden(view: View, sx: number, sy: number): Point {
  return { x: view.x + sx / view.zoom, y: view.y + sy / view.zoom };
}
/** Zooms by `factor`, keeping the garden point under screen offset (sx, sy) where it is. */
export function zoomAt(view: View, sx: number, sy: number, factor: number): View {
  const zoom = clampZoom(view.zoom * factor);
  const p = screenToGarden(view, sx, sy);
  return { zoom, x: p.x - sx / zoom, y: p.y - sy / zoom };
}
/** Pans by a screen-pixel delta (dragging content right moves the camera left). */
export function panBy(view: View, dxPx: number, dyPx: number): View {
  return { ...view, x: view.x - dxPx / view.zoom, y: view.y - dyPx / view.zoom };
}
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
/**
 * The view that centers `bounds` in the part of a `width` × `height` viewport left clear by
 * `insets` (room for overlaid toolbars and panels), as large as fits (up to `maxZoom`). An empty garden frames
 * a default 8′ × 4′ patch of ground at the origin.
 */
export function fitView(
  bounds: Bounds | null,
  width: number,
  height: number,
  insets: Insets,
  maxZoom = MAX_ZOOM,
): View {
  const b = bounds ?? { x0: 0, y0: 0, x1: 96, y1: 48 };
  const availW = Math.max(120, width - insets.left - insets.right);
  const availH = Math.max(120, height - insets.top - insets.bottom);
  const zoom = Math.min(maxZoom, clampZoom(Math.min(availW / Math.max(12, b.x1 - b.x0), availH / Math.max(12, b.y1 - b.y0))));
  return {
    zoom,
    x: (b.x0 + b.x1) / 2 - (insets.left + availW / 2) / zoom,
    y: (b.y0 + b.y1) / 2 - (insets.top + availH / 2) / zoom,
  };
}
/** A press that travels further than this many screen pixels is a drag, not a click. */
export const CLICK_SLOP_PX = 3;
export function isDrag(dxPx: number, dyPx: number): boolean {
  return Math.hypot(dxPx, dyPx) > CLICK_SLOP_PX;
}
/**
 * Largest wheel delta one event may zoom by. Trackpad pinches send small deltas and are
 * unaffected; a mouse wheel sends ~100 per notch, which would otherwise zoom ~2.7× per click.
 */
export const MAX_WHEEL_ZOOM_DELTA = 25;
/** Zoom factor for one wheel/pinch event: smooth, and symmetric so in-then-out returns to start. */
export function wheelZoomFactor(deltaY: number): number {
  const d = Math.max(-MAX_WHEEL_ZOOM_DELTA, Math.min(MAX_WHEEL_ZOOM_DELTA, deltaY));
  return Math.exp(-d * 0.01);
}
/** Zoom as a percentage of the planting view's scale. */
export function zoomPercent(view: View): number {
  return Math.round((view.zoom / PLANTING_PX_PER_INCH) * 100);
}
/**
 * The CSS transform that draws content laid out at `pxPerInch` (its top-left at garden point
 * `origin`) as seen through `view`: translate by (x, y) px, then scale, from the top-left.
 */
export function contentTransform(view: View, origin: Point, pxPerInch: number): { x: number; y: number; scale: number } {
  return { x: (origin.x - view.x) * view.zoom, y: (origin.y - view.y) * view.zoom, scale: view.zoom / pxPerInch };
}
/**
 * The camera for a two-finger gesture: `start` is the view when the fingers went down at
 * screen offsets a0 and b0, and they're now at a1 and b1. The garden point under each finger's
 * midpoint stays under it, and the zoom follows the change in the fingers' distance.
 */
export function pinchView(start: View, a0: Point, b0: Point, a1: Point, b1: Point): View {
  const dist0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const dist1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const zoomed = dist0 > 0 ? zoomAt(start, mid0.x, mid0.y, dist1 / dist0) : start;
  return panBy(zoomed, mid1.x - mid0.x, mid1.y - mid0.y);
}