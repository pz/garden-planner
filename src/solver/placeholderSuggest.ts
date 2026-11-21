import { applyCommands } from '../api/apply';
import type { Command } from '../api/commands';
import type { CropRequest } from '../core/adjust';
import { isOccupied } from '../core/planting';
import { radiusOf } from '../core/placement';
import { bedOutline } from '../core/layout';
import { getCrop } from '../data/crops';
import type { Bed, PlantInstance, Point } from '../types';
import { insideWithClearance } from './rules';
import { bedFullness, type AddedPlant, type DiffRow, type Suggester, type Suggestion } from './suggestion';

// A stand-in for the planting solver, so the "adjust the plan" card can be built and tried before
// the two are joined. It does the simplest thing that shows every part of the interface: it takes
// plants out from the end of a crop's plants, and puts new ones on a grid in the first free spots
// it finds. It does not rearrange, weigh crops against each other or look at shade, and "Try
// again" only shifts where it starts looking. Replaced by `solve` in the next step.

/** How many plants a "more" adds, as a share of what is there (at least one). */
const SOFT_SHARE = 0.25;

/** A new crop asked for as "more" with nothing planted yet starts at this many plants. */
export const startCount = (cropId: string): number => (getCrop(cropId).defaultPatch ? 6 : 2);

/** How many plants a request is aiming for, given how many there are now. */
export function targetOf(request: CropRequest, current: number, cropId: string): number {
  if (request.kind === 'exact') return request.target;
  if (request.kind === 'fewer') return Math.max(0, current - Math.max(1, Math.round(current * SOFT_SHARE)));
  return current === 0 ? startCount(cropId) : current + Math.max(1, Math.round(current * SOFT_SHARE));
}

interface Disc {
  x: number;
  y: number;
  r: number;
}

/** Grid points for plants of one crop in one bed, in the bed's own frame, in the order a scan visits them. */
function candidates(bed: Bed, cropId: string, attempt: number): Point[] {
  const s = getCrop(cropId).spacingIn;
  const r = radiusOf(cropId);
  const shift = ((attempt % 4) * s) / 4;
  const out: Point[] = [];
  // Half a spacing apart, so a free spot between plants that were not planted on this grid is still found.
  const step = Math.max(s / 2, 1);
  for (let y = r / 2 + shift; y <= bed.heightIn; y += step) for (let x = r / 2 + shift; x <= bed.widthIn; x += step) out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  return attempt % 2 === 1 ? out.reverse() : out;
}

export const placeholderSuggest: Suggester = (plan, request) => {
  const scope = request.bedId === undefined ? plan.beds : plan.beds.filter((b) => b.id === request.bedId);
  const scopeIds = new Set(scope.map((b) => b.id));
  const inScope = plan.plants.filter((p) => scopeIds.has(p.bedId));
  const discs = new Map<string, Disc[]>(plan.beds.map((b) => [b.id, plan.plants.filter((p) => p.bedId === b.id).map((p) => ({ x: p.x, y: p.y, r: radiusOf(p.cropId) }))]));

  const removed: string[] = [];
  const adds: AddedPlant[] = [];
  const rows: DiffRow[] = [];
  const said: string[] = [];

  for (const { cropId, request: req } of request.wants) {
    const mine = inScope.filter((p) => p.cropId === cropId);
    const before = mine.length;
    const target = targetOf(req, before, cropId);
    let after = before;

    if (target < before) {
      // The newest plants go first.
      for (const p of [...mine].reverse().slice(0, before - target)) {
        removed.push(p.id);
        const list = discs.get(p.bedId)!;
        const i = list.findIndex((d) => d.x === p.x && d.y === p.y && d.r === radiusOf(cropId));
        if (i >= 0) list.splice(i, 1);
        after--;
      }
    } else if (target > before) {
      const r = radiusOf(cropId);
      // One plant at a time, in the free spot furthest from everything else, so new plants spread out instead of crowding a corner.
      while (after < target) {
        let best: { bed: Bed; p: Point; gap: number } | null = null;
        for (const bed of scope) {
          const outline = bedOutline(bed);
          const taken = discs.get(bed.id)!;
          for (const p of candidates(bed, cropId, request.attempt)) {
            if (!insideWithClearance(p, r / 2, outline) || isOccupied(p, r, taken)) continue;
            // In an empty bed there is nothing to keep clear of, so the middle is as good a place as any.
            const gap = taken.length ? taken.reduce((m, d) => Math.min(m, Math.hypot(d.x - p.x, d.y - p.y) - (r + d.r)), Infinity) : 1000 - Math.hypot(p.x - bed.widthIn / 2, p.y - bed.heightIn / 2);
            if (!best || gap > best.gap + 1e-9) best = { bed, p, gap };
          }
        }
        if (!best) break;
        discs.get(best.bed.id)!.push({ x: best.p.x, y: best.p.y, r });
        adds.push({ cropId, bedId: best.bed.id, x: best.p.x, y: best.p.y });
        after++;
      }
    }

    const row: DiffRow = { cropId, before, after };
    if (after !== target && req.kind === 'exact') row.note = after > before ? `only room for ${after}` : `could not reach ${target}`;
    else if (after === before && req.kind !== 'exact') row.note = req.kind === 'more' ? 'no room for more' : 'nothing to take out';
    rows.push(row);
    const name = getCrop(cropId).name.toLowerCase();
    if (after > before) said.push(`added ${after - before} ${name}`);
    if (after < before) said.push(`removed ${before - after} ${name}`);
  }

  const commands: Command[] = removed.map((id) => ({ type: 'removePlant', id }));
  const byBedAndCrop = new Map<string, AddedPlant[]>();
  for (const a of adds) byBedAndCrop.set(`${a.bedId}|${a.cropId}`, [...(byBedAndCrop.get(`${a.bedId}|${a.cropId}`) ?? []), a]);
  for (const group of byBedAndCrop.values()) commands.push({ type: 'addPatch', bedId: group[0].bedId, cropId: group[0].cropId, points: group.map((g) => ({ x: g.x, y: g.y })) });

  const place = scope.length === 1 ? ` in ${scope[0].name}` : '';
  const short = rows.filter((r) => r.note).map((r) => `${getCrop(r.cropId).name}: ${r.note}`);
  const reasoning = [said.length ? `${said.join(' and ')}${place}.`.replace(/^./, (c) => c.toUpperCase()) : 'Nothing needed to change.', ...short.map((s) => `${s}.`)].join(' ');

  // The plants after the change, to say how full the scope ends up. A dry run also proves the commands are valid.
  const after: PlantInstance[] = [...plan.plants.filter((p) => !removed.includes(p.id)), ...adds.map((a, i) => ({ id: `suggested-${i}`, groupId: `suggested-${a.bedId}-${a.cropId}`, bedId: a.bedId, cropId: a.cropId, x: a.x, y: a.y }))];
  let n = 0;
  const dry = commands.length ? applyCommands(plan, commands, { newId: () => `dry-${++n}`, dryRun: true, scope: 'planting' }) : null;
  if (dry && !dry.ok) {
    return { commands: [], adds: [], removed: [], rows: rows.map((r) => ({ ...r, after: r.before, note: 'could not be placed' })), reasoning: 'This request could not be placed.', fullness: { before: bedFullness(scope, inScope), after: bedFullness(scope, inScope) }, attempt: request.attempt };
  }

  const suggestion: Suggestion = { commands, adds, removed, rows, reasoning, fullness: { before: bedFullness(scope, inScope), after: bedFullness(scope, after) }, attempt: request.attempt };
  return suggestion;
};
