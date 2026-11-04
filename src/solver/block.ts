import type { PlantInstance, Point } from '../types';
import { getCrop } from '../data/crops';
import { gridPoints, isInsideOutline, type Outline } from '../core/geometry';

/**
 * The solver plans in blocks: a rectangular grid of one crop at that crop's spacing, in one
 * bed's local (unrotated) frame, which becomes one patch. A block maps to exactly one `addPatch`
 * in its grid form.
 */
export interface Block {
  bedId: string;
  cropId: string;
  /** The first plant's center, which is also the block's top-left corner. */
  origin: Point;
  /**
   * Always `x` for blocks the solver builds: a `columns × rows` block on axis `y` is the same
   * set of points as a `rows × columns` block on axis `x`, and the search already tries every
   * shape. Kept in the type so a command round-trips.
   */
  axis: 'x' | 'y';
  columns: number;
  rows: number;
  /** `new`, or an existing patch being kept or moved. */
  source: 'new' | { groupId: string };
}

/** Distance between neighbouring block origins the search tries, in inches (fine enough for the smallest crop spacing, 2 in, within a step or two, and coarse enough to search). */
export const LATTICE_IN = 3;

/** How far apart two coordinates may be and still count as the same grid line, in inches. */
export const GRID_TOLERANCE_IN = 0.01;

/** Floating-point slack on top of the tolerance, so a difference of exactly 0.01 that rounds to 0.0100000000001 still counts. */
const FP_SLACK = 1e-9;

export const blockSpacing = (b: Pick<Block, 'cropId'>): number => getCrop(b.cropId).spacingIn;

export const blockPlantCount = (b: Pick<Block, 'columns' | 'rows'>): number => b.columns * b.rows;

/** The plant centers of a block, in its bed's frame, row by row. */
export function blockPoints(b: Block): Point[] {
  return gridPoints(b.origin, b.axis, b.columns, b.rows, blockSpacing(b));
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The box around a block's plant centers, in its bed's frame. */
export function blockBox(b: Block): Box {
  const s = blockSpacing(b);
  const w = (b.axis === 'x' ? b.columns : b.rows) - 1;
  const h = (b.axis === 'x' ? b.rows : b.columns) - 1;
  return { x0: b.origin.x, y0: b.origin.y, x1: b.origin.x + w * s, y1: b.origin.y + h * s };
}

/** Anchor positions: lattice points inside the outline (the bed's own frame, boundary included). */
export function latticeAnchors(outline: Outline, stepIn = LATTICE_IN): Point[] {
  const out: Point[] = [];
  for (let x = 0; x <= outline.widthIn; x += stepIn) {
    for (let y = 0; y <= outline.heightIn; y += stepIn) {
      const p = { x, y };
      if (isInsideOutline(p, outline)) out.push(p);
    }
  }
  return out;
}

/** The distinct values of `xs`, ascending, merging any within `GRID_TOLERANCE_IN` of the previous one. */
function lines(xs: number[]): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || v - out[out.length - 1] > GRID_TOLERANCE_IN + FP_SLACK) out.push(v);
  return out;
}

/**
 * The block an existing patch is, if it is one: all its plants in one bed and crop, forming a
 * full `columns × rows` grid at the crop's spacing (within `GRID_TOLERANCE_IN`). Null otherwise
 * (an L, a gap, a different spacing, mixed crops): the solver treats such a patch as fixed.
 * The block's source is the patch's groupId.
 */
export function asBlock(plants: PlantInstance[]): Block | null {
  if (plants.length === 0) return null;
  const { bedId, cropId, groupId } = plants[0];
  if (plants.some((p) => p.bedId !== bedId || p.cropId !== cropId || p.groupId !== groupId)) return null;
  const s = getCrop(cropId).spacingIn;
  const xs = lines(plants.map((p) => p.x));
  const ys = lines(plants.map((p) => p.y));
  if (xs.length * ys.length !== plants.length) return null;
  const evenlySpaced = (v: number[]) => v.every((x, i) => i === 0 || Math.abs(x - v[i - 1] - s) <= GRID_TOLERANCE_IN + FP_SLACK);
  if (!evenlySpaced(xs) || !evenlySpaced(ys)) return null;
  // Each (column, row) must hold exactly one plant; with the count matching, no cell may be empty or doubled.
  const cell = (v: number[], x: number) => v.findIndex((l) => Math.abs(l - x) <= GRID_TOLERANCE_IN + FP_SLACK);
  const seen = new Set<number>();
  for (const p of plants) seen.add(cell(xs, p.x) * ys.length + cell(ys, p.y));
  if (seen.size !== plants.length) return null;
  return { bedId, cropId, origin: { x: xs[0], y: ys[0] }, axis: 'x', columns: xs.length, rows: ys.length, source: { groupId } };
}
