import { getCrop } from '../data/crops';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { isInsideOutline } from '../core/geometry';
import { bedOutline } from '../core/layout';
import type { ApiError } from './types';

export interface LayoutOptions {
  /** Only this bed. */
  bedId?: string;
  /** Edge of one grid cell, in inches. Default 6, the layout editor's snap step. */
  cellIn?: number;
}

export const DEFAULT_CELL_IN = 6;
/** Most cells a grid may have; a finer `cellIn` than this allows is rejected. */
export const MAX_GRID_CELLS = 10_000;

export interface PatchSummary {
  groupId: string;
  cropId: string;
  count: number;
  /** Box around the patch's plant centers, in the bed's own frame (inches). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

export interface BedLayout {
  id: string;
  name: string;
  shape: Bed['shape'];
  /** Where the bed sits in the garden, as stored. */
  cx: number;
  cy: number;
  widthIn: number;
  heightIn: number;
  rotationDeg: number;
  plantCount: number;
  patches: PatchSummary[];
  /**
   * The bed in its own (unrotated) frame, one string per row of cells, top to bottom:
   * `#` outside the bed's shape, `.` free, a capital letter where a plant's center is, a
   * lowercase letter where a plant's growing room covers the cell. `legend` maps each capital
   * letter to its crop id. Coordinates are `column × cellIn`, `row × cellIn`.
   */
  grid: { cellIn: number; columns: number; rows: number; lines: string[]; legend: Record<string, string> };
  /** Share of the bed's cells (inside its shape) that are free, 0 to 1. */
  freeFraction: number;
}

export interface Layout {
  beds: BedLayout[];
}

export type LayoutResult = { ok: true; layout: Layout } | { ok: false; errors: ApiError[] };

/** One capital letter per crop in use: the first letter of its name, else the next unused letter of the name, else any free one. */
function assignSymbols(cropIds: string[]): Map<string, string> {
  const symbols = new Map<string, string>();
  const used = new Set<string>();
  for (const id of [...new Set(cropIds)].sort()) {
    const letters = [...getCrop(id).name.toUpperCase().replace(/[^A-Z]/g, ''), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
    const pick = letters.find((l) => !used.has(l));
    if (pick) {
      used.add(pick);
      symbols.set(id, pick);
    }
  }
  return symbols;
}

function summarize(plants: PlantInstance[]): PatchSummary[] {
  const byGroup = new Map<string, PlantInstance[]>();
  for (const p of plants) byGroup.set(p.groupId, [...(byGroup.get(p.groupId) ?? []), p]);
  return [...byGroup].map(([groupId, members]) => ({
    groupId,
    cropId: members[0].cropId,
    count: members.length,
    bounds: {
      x0: Math.min(...members.map((m) => m.x)),
      y0: Math.min(...members.map((m) => m.y)),
      x1: Math.max(...members.map((m) => m.x)),
      y1: Math.max(...members.map((m) => m.y)),
    },
  }));
}

function bedLayout(bed: Bed, plants: PlantInstance[], cellIn: number, symbols: Map<string, string>): BedLayout {
  const columns = Math.ceil(bed.widthIn / cellIn);
  const rows = Math.ceil(bed.heightIn / cellIn);
  const outline = bedOutline(bed);
  const cellOf = (v: number, count: number) => Math.min(count - 1, Math.max(0, Math.floor(v / cellIn)));
  const centerCell = new Map<string, PlantInstance>(); // "row,col" → the first plant whose center is in that cell
  for (const p of plants) {
    const key = `${cellOf(p.y, rows)},${cellOf(p.x, columns)}`;
    if (!centerCell.has(key)) centerCell.set(key, p);
  }

  const lines: string[] = [];
  let inside = 0;
  let free = 0;
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < columns; c++) {
      // The middle of the cell, which for the last partial row/column is the middle of what's left of it.
      const mid = {
        x: (c * cellIn + Math.min((c + 1) * cellIn, bed.widthIn)) / 2,
        y: (r * cellIn + Math.min((r + 1) * cellIn, bed.heightIn)) / 2,
      };
      if (!isInsideOutline(mid, outline)) {
        line += '#';
        continue;
      }
      inside++;
      const here = centerCell.get(`${r},${c}`);
      if (here) {
        line += symbols.get(here.cropId) ?? '?';
        continue;
      }
      let nearest: { plant: PlantInstance; d: number } | null = null;
      for (const p of plants) {
        const d = Math.hypot(p.x - mid.x, p.y - mid.y);
        if (d < getCrop(p.cropId).spacingIn / 2 && (!nearest || d < nearest.d)) nearest = { plant: p, d };
      }
      if (nearest) line += (symbols.get(nearest.plant.cropId) ?? '?').toLowerCase();
      else {
        line += '.';
        free++;
      }
    }
    lines.push(line);
  }

  const legend: Record<string, string> = {};
  for (const id of new Set(plants.map((p) => p.cropId))) {
    const symbol = symbols.get(id);
    if (symbol) legend[symbol] = id;
  }
  return {
    id: bed.id,
    name: bed.name,
    shape: bed.shape,
    cx: bed.cx,
    cy: bed.cy,
    widthIn: bed.widthIn,
    heightIn: bed.heightIn,
    rotationDeg: bed.rotationDeg,
    plantCount: plants.length,
    patches: summarize(plants),
    grid: { cellIn, columns, rows, lines, legend },
    freeFraction: inside === 0 ? 0 : free / inside,
  };
}

/**
 * A picture of the garden an agent can read: for each bed, its place, its patches and a coarse
 * text grid showing what is where and what is free. Raw coordinates are hard to reason about;
 * this is the same information laid out spatially.
 */
export function readLayout(plan: GardenPlan, options: LayoutOptions = {}): LayoutResult {
  const cellIn = options.cellIn ?? DEFAULT_CELL_IN;
  const errors: ApiError[] = [];
  if (!Number.isFinite(cellIn) || cellIn <= 0) {
    errors.push({ code: 'invalid_command', path: '/cellIn', message: 'cellIn must be a positive number of inches.' });
  }
  const beds = options.bedId === undefined ? plan.beds : plan.beds.filter((b) => b.id === options.bedId);
  if (options.bedId !== undefined && beds.length === 0) {
    errors.push({ code: 'unknown_bed', path: '/bedId', message: `There is no bed with id "${options.bedId}".`, details: { bedId: options.bedId } });
  }
  if (errors.length === 0) {
    for (const b of beds) {
      const cells = Math.ceil(b.widthIn / cellIn) * Math.ceil(b.heightIn / cellIn);
      if (cells > MAX_GRID_CELLS) {
        errors.push({ code: 'invalid_command', path: '/cellIn', message: `A cellIn of ${cellIn} makes ${cells} cells for bed "${b.name}"; the most is ${MAX_GRID_CELLS}. Use a larger cellIn.`, details: { bedId: b.id, cells } });
      }
    }
  }
  if (errors.length) return { ok: false, errors };

  const symbols = assignSymbols(plan.plants.map((p) => p.cropId));
  return { ok: true, layout: { beds: beds.map((b) => bedLayout(b, plan.plants.filter((p) => p.bedId === b.id), cellIn, symbols)) } };
}
