import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface GroupBox {
  groupId: string;
  cropId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export const GROUP_BOX_PAD_IN = 1.25;

/** Axis-aligned bounding box around a set of circles, expanded by each circle's own radius. */
export function boundingBox(points: { x: number; y: number; r: number }[], padIn: number): Omit<GroupBox, 'groupId' | 'cropId'> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x - p.r);
    minY = Math.min(minY, p.y - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  return { left: minX - padIn, top: minY - padIn, width: maxX - minX + padIn * 2, height: maxY - minY + padIn * 2 };
}

/** One bounding box per patch (a groupId shared by more than one plant) so it reads as a single entity. */
export function computeGroupBoxes(plants: PlantInstance[]): GroupBox[] {
  const byGroup = new Map<string, PlantInstance[]>();
  for (const p of plants) {
    const members = byGroup.get(p.groupId);
    if (members) members.push(p);
    else byGroup.set(p.groupId, [p]);
  }
  const boxes: GroupBox[] = [];
  for (const [groupId, members] of byGroup) {
    if (members.length < 2) continue;
    const points = members.map((m) => ({ x: m.x, y: m.y, r: getCrop(m.cropId).spacingIn / 2 }));
    boxes.push({ groupId, cropId: members[0].cropId, ...boundingBox(points, GROUP_BOX_PAD_IN) });
  }
  return boxes;
}

export const AXIS_LOCK_THRESHOLD_FACTOR = 0.6;

/**
 * Locks a drag to whichever of the bed's two edges it's more aligned with. Patches always
 * run horizontal or vertical, never diagonal — simpler to reason about in a small bed than
 * a freely-rotated patch, and it keeps every patch's footprint an axis-aligned rectangle.
 */
export function lockedAxis(dx: number, dy: number): Point {
  return Math.abs(dx) >= Math.abs(dy) ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

/**
 * Ghost points for a patch dragged out from `origin` along a locked `axis` — one column per
 * spacing step along the axis, one row per spacing step perpendicular to it, so a single drag
 * sweeps out a line (rows = 0) or a rectangular grid (rows > 0), matching "drag a patch to
 * size." Only a ghost's own center has to stay inside the bed, matching plant placement rules
 * generally — its spacing ring may extend past the edge.
 */
export function computeGhosts(
  origin: Point,
  axis: Point,
  cursor: Point,
  spacingIn: number,
  boundW: number,
  boundH: number,
): Point[] {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const u = dx * axis.x + dy * axis.y; // signed distance along the axis
  const v = -dx * axis.y + dy * axis.x; // signed distance perpendicular to it
  const cols = Math.max(0, Math.floor(Math.abs(u) / spacingIn));
  const rows = Math.max(0, Math.floor(Math.abs(v) / spacingIn));
  const colSign = u < 0 ? -1 : 1;
  const rowSign = v < 0 ? -1 : 1;
  const perpX = -axis.y;
  const perpY = axis.x;

  const pts: Point[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      if (row === 0 && col === 0) continue; // origin is already a placed plant
      const x = origin.x + axis.x * spacingIn * col * colSign + perpX * spacingIn * row * rowSign;
      const y = origin.y + axis.y * spacingIn * col * colSign + perpY * spacingIn * row * rowSign;
      if (x < 0 || y < 0 || x > boundW || y > boundH) continue;
      pts.push({ x, y });
    }
  }
  return pts;
}

/**
 * Clamp a proposed (dx, dy) translation so every member of a group keeps its center inside
 * the bed once moved — keeping the whole patch rigid (every member shifts by the same
 * amount) rather than letting the bed edge distort its shape.
 */
export function clampGroupDelta(members: PlantInstance[], dx: number, dy: number, boundW: number, boundH: number): Point {
  let minDx = -Infinity;
  let maxDx = Infinity;
  let minDy = -Infinity;
  let maxDy = Infinity;
  for (const m of members) {
    minDx = Math.max(minDx, -m.x);
    maxDx = Math.min(maxDx, boundW - m.x);
    minDy = Math.max(minDy, -m.y);
    maxDy = Math.min(maxDy, boundH - m.y);
  }
  return { x: Math.min(maxDx, Math.max(minDx, dx)), y: Math.min(maxDy, Math.max(minDy, dy)) };
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Clamps a pan offset so the (already-zoomed) content never leaves the viewport fully out of
 * view: an axis where content is smaller than the viewport is centered and can't be panned at
 * all, otherwise pan is clamped so the viewport stays fully covered by content on that axis.
 */
export function clampPan(pan: Point, viewport: Size, content: Size): Point {
  return {
    x: clampPanAxis(pan.x, viewport.width, content.width),
    y: clampPanAxis(pan.y, viewport.height, content.height),
  };
}

function clampPanAxis(p: number, viewport: number, content: number): number {
  if (content <= viewport) return (viewport - content) / 2;
  return Math.min(0, Math.max(viewport - content, p));
}

/**
 * The unscaled content-space point currently rendered at `viewportLocal` (viewport-relative
 * pixels), given the content layer's current pan/zoom transform (`translate(pan) scale(zoom)`,
 * origin 0,0). Inverse of `panToAlign`.
 */
export function contentPointAt(viewportLocal: Point, pan: Point, zoom: number): Point {
  return { x: (viewportLocal.x - pan.x) / zoom, y: (viewportLocal.y - pan.y) / zoom };
}

/** The pan that renders unscaled content point `contentPoint` at `viewportLocal`, at `zoom`. */
export function panToAlign(contentPoint: Point, viewportLocal: Point, zoom: number): Point {
  return { x: viewportLocal.x - contentPoint.x * zoom, y: viewportLocal.y - contentPoint.y * zoom };
}

/** Converts a viewport-relative pixel point to bed inches, clamped to the bed's own bounds. */
export function clientToBedCoords(
  viewportLocal: Point,
  pan: Point,
  zoom: number,
  pxPerInch: number,
  boundW: number,
  boundH: number,
): Point {
  const contentPx = contentPointAt(viewportLocal, pan, zoom);
  return {
    x: Math.min(boundW, Math.max(0, contentPx.x / pxPerInch)),
    y: Math.min(boundH, Math.max(0, contentPx.y / pxPerInch)),
  };
}

/**
 * The zoom level that fits the whole content within the viewport, never exceeding 100% —
 * "fit" only zooms out to reveal everything, it never zooms in past true scale.
 */
export function computeFitZoom(viewport: Size, content: Size): number {
  return clampZoom(Math.min(1, viewport.width / content.width, viewport.height / content.height));
}
