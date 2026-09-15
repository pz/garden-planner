import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';

export interface Point {
  x: number;
  y: number;
}

export interface GroupBox {
  groupId: string;
  cropId: string;
  /** Center of the box, in inches. */
  centerX: number;
  centerY: number;
  /** Extent along the box's own axes, in inches (not world-axis-aligned). */
  width: number;
  height: number;
  /** Rotation of the box's width-axis from the world x-axis, in degrees. */
  angleDeg: number;
}

export const GROUP_BOX_PAD_IN = 1.25;

/**
 * Minimum-footprint oriented bounding box around a set of circles, so a diagonal
 * line of plants gets a diagonal box instead of an axis-aligned one that balloons
 * to fit the diagonal. Orientation comes from the points' principal axis (PCA on
 * the 2x2 covariance matrix) — exact for a line of points, and a reasonable
 * best-fit for any other cluster shape.
 */
export function computeOrientedBox(
  points: { x: number; y: number; r: number }[],
  padIn: number,
): Omit<GroupBox, 'groupId' | 'cropId'> {
  const n = points.length;
  const cx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const u = dx * cosA + dy * sinA;
    const v = -dx * sinA + dy * cosA;
    minU = Math.min(minU, u - p.r);
    maxU = Math.max(maxU, u + p.r);
    minV = Math.min(minV, v - p.r);
    maxV = Math.max(maxV, v + p.r);
  }

  const localCenterU = (minU + maxU) / 2;
  const localCenterV = (minV + maxV) / 2;
  return {
    centerX: cx + localCenterU * cosA - localCenterV * sinA,
    centerY: cy + localCenterU * sinA + localCenterV * cosA,
    width: maxU - minU + padIn * 2,
    height: maxV - minV + padIn * 2,
    angleDeg: (angle * 180) / Math.PI,
  };
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
    boxes.push({ groupId, cropId: members[0].cropId, ...computeOrientedBox(points, GROUP_BOX_PAD_IN) });
  }
  return boxes;
}

/** Evenly-spaced points along the drag ray from `origin`, clipped to the bed bounds. */
export function computeGhosts(
  origin: Point,
  cursor: Point,
  spacingIn: number,
  boundW: number,
  boundH: number,
): Point[] {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < spacingIn * 0.6) return [];
  const steps = Math.floor(dist / spacingIn);
  const ux = dx / dist;
  const uy = dy / dist;
  const pts: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const x = origin.x + ux * spacingIn * i;
    const y = origin.y + uy * spacingIn * i;
    const r = spacingIn / 2;
    if (x - r < 0 || y - r < 0 || x + r > boundW || y + r > boundH) continue;
    pts.push({ x, y });
  }
  return pts;
}
