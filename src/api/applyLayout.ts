import { CROPS } from '../data/crops';
import { ZONES } from '../data/zones';
import type { Bed, PlantInstance, Profile } from '../types';
import { clampToOutline, isInsideOutline } from '../core/geometry';
import { bedOutline, bedProblems, nextBedName, relocatePlants, type BedGeometry } from '../core/layout';
import { parseGardenLocation } from '../core/location';
import type { Action } from '../core/reducer';
import { validatePlan } from '../core/validatePlan';
import type { LayoutCommand, PasteBedCommand, ReshapeBedCommand, RestoreLayoutCommand, SetProfileCommand } from './commands';
import { fmt, round, type Ctx, type Outcome } from './applyShared';

function bedById(ctx: Ctx, id: string, field = 'id'): Bed | null {
  const bed = ctx.plan.beds.find((b) => b.id === id);
  if (!bed) ctx.report({ code: 'unknown_bed', path: `${ctx.at}/${field}`, message: `There is no bed with id "${id}".`, details: { bedId: id } });
  return bed ?? null;
}

/** Reports each problem with a bed as its own `invalid_bed` error; true if there were none. */
function bedIsValid(ctx: Ctx, bed: Bed, path = ctx.at): boolean {
  const problems = bedProblems(bed);
  for (const problem of problems) {
    ctx.report({ code: 'invalid_bed', path, message: `Bed "${bed.name}" isn't valid: ${problem}.`, details: { problem } });
  }
  return problems.length === 0;
}

function geometryOfCommand(c: ReshapeBedCommand): BedGeometry {
  const g: BedGeometry = { cx: c.cx, cy: c.cy, widthIn: c.widthIn, heightIn: c.heightIn };
  if (c.points !== undefined) g.points = c.points;
  if (c.cornerRadiusIn !== undefined) g.cornerRadiusIn = c.cornerRadiusIn;
  return g;
}

function reshapeBed(ctx: Ctx, c: ReshapeBedCommand): Outcome {
  const prev = bedById(ctx, c.id);
  if (!prev) return null;
  const geometry = geometryOfCommand(c);
  const next: Bed = { ...prev, ...geometry };
  // The reducer would quietly ignore a polygon reshaped without corners; say so instead.
  if (prev.shape === 'polygon' && c.points === undefined) {
    ctx.report({ code: 'invalid_bed', path: ctx.at, message: `Bed "${prev.name}" is a polygon, so reshaping it needs its corner points.` });
    return null;
  }
  if (!bedIsValid(ctx, next)) return null;
  const removed = relocatePlants(prev, next, ctx.plan.plants).outsideIds;
  return { actions: [{ type: 'reshapeBed', id: prev.id, geometry }], result: { type: 'reshapeBed', bedId: prev.id, removed } };
}

function pasteBed(ctx: Ctx, c: PasteBedCommand): Outcome {
  const { bed, plants } = c;
  let ok = bedIsValid(ctx, bed, `${ctx.at}/bed`);
  if (ctx.plan.beds.some((b) => b.id === bed.id)) {
    ctx.report({ code: 'duplicate_id', path: `${ctx.at}/bed/id`, message: `A bed with id "${bed.id}" already exists.`, details: { bedId: bed.id } });
    ok = false;
  }
  const taken = new Set(ctx.plan.plants.map((p) => p.id));
  const outline = ok ? bedOutline(bed) : null;
  plants.forEach((p, k) => {
    const at = `${ctx.at}/plants/${k}`;
    if (p.bedId !== bed.id) {
      ctx.report({ code: 'unknown_bed', path: `${at}/bedId`, message: `Plant ${k + 1} belongs to bed "${p.bedId}", not the pasted bed "${bed.id}".` });
      ok = false;
    }
    if (!CROPS.some((cr) => cr.id === p.cropId)) {
      ctx.report({ code: 'unknown_crop', path: `${at}/cropId`, message: `There is no crop with id "${p.cropId}".`, details: { cropId: p.cropId } });
      ok = false;
    }
    if (taken.has(p.id)) {
      ctx.report({ code: 'duplicate_id', path: `${at}/id`, message: `A plant with id "${p.id}" already exists.`, details: { id: p.id } });
      ok = false;
    }
    taken.add(p.id);
    if (outline && !isInsideOutline({ x: p.x, y: p.y }, outline)) {
      ctx.report({
        code: 'outside_bed',
        path: at,
        message: `Plant ${k + 1} at ${fmt(p)} is outside bed "${bed.name}" (${round(bed.widthIn)}×${round(bed.heightIn)} in ${bed.shape}).`,
        details: { bedId: bed.id, point: { x: p.x, y: p.y } },
        suggestion: { nearestValidPoint: clampToOutline({ x: p.x, y: p.y }, outline) },
      });
      ok = false;
    }
  });
  if (!ok) return null;
  return { actions: [{ type: 'pasteBed', bed, plants }], result: { type: 'pasteBed', bedId: bed.id, plantIds: plants.map((p) => p.id) } };
}

/**
 * Restoring is lenient about where plants sit (a snapshot may predate a rule), but the layout
 * must still be a well-formed garden: known beds and crops, unique ids, finite positions.
 */
function restoreLayout(ctx: Ctx, c: RestoreLayoutCommand): Outcome {
  const problems = validatePlan({ ...ctx.plan, beds: c.beds, plants: c.plants });
  for (const p of problems) {
    ctx.report({ code: p.code === 'invalid_garden_file' ? 'invalid_command' : p.code, path: `${ctx.at}${p.path}`, message: `The layout to restore isn't valid: ${p.message}.` });
  }
  if (problems.length) return null;
  return { actions: [{ type: 'restoreLayout', beds: c.beds, plants: c.plants }], result: { type: 'restoreLayout' } };
}

function setProfile(ctx: Ctx, c: SetProfileCommand): Outcome {
  const { profile } = c;
  let ok = true;
  if (!ZONES.some((z) => z.id === profile.zoneId)) {
    ctx.report({ code: 'invalid_profile', path: `${ctx.at}/profile/zoneId`, message: `"${profile.zoneId}" isn't a known hardiness zone.`, details: { zoneId: profile.zoneId } });
    ok = false;
  }
  const location = profile.location === undefined ? undefined : parseGardenLocation(profile.location);
  if (profile.location !== undefined && !location) {
    ctx.report({ code: 'invalid_profile', path: `${ctx.at}/profile/location`, message: 'The location must have a latitude from -90 to 90 and a longitude.' });
    ok = false;
  }
  if (!ok) return null;
  const clean: Profile = { zoneId: profile.zoneId, sunExposure: profile.sunExposure, onboarded: profile.onboarded };
  if (location) clean.location = location;
  return { actions: [{ type: 'setProfile', profile: clean }], result: { type: 'setProfile' } };
}

/** Plant ids in a bed, i.e. what goes when the bed does. */
const plantsIn = (ctx: Ctx, bedId: string): PlantInstance[] => ctx.plan.plants.filter((p) => p.bedId === bedId);

export function applyLayoutCommand(ctx: Ctx, c: LayoutCommand): Outcome {
  switch (c.type) {
    case 'addBed': {
      const id = c.id ?? ctx.newId();
      const bed: Bed = {
        id,
        name: c.name ?? nextBedName(ctx.plan.beds),
        shape: c.shape,
        cx: c.cx,
        cy: c.cy,
        widthIn: c.widthIn,
        heightIn: c.heightIn,
        rotationDeg: c.rotationDeg ?? 0,
      };
      if (c.points !== undefined) bed.points = c.points;
      if (c.cornerRadiusIn !== undefined) bed.cornerRadiusIn = c.cornerRadiusIn;
      let ok = bedIsValid(ctx, bed);
      if (ctx.plan.beds.some((b) => b.id === id)) {
        ctx.report({ code: 'duplicate_id', path: `${ctx.at}/id`, message: `A bed with id "${id}" already exists.`, details: { bedId: id } });
        ok = false;
      }
      return ok ? { actions: [{ type: 'addBed', bed }], result: { type: 'addBed', bedId: id } } : null;
    }
    case 'renameBed': {
      const bed = bedById(ctx, c.id);
      return bed ? { actions: [{ type: 'renameBed', id: bed.id, name: c.name }], result: { type: 'renameBed', bedId: bed.id } } : null;
    }
    case 'moveBed': {
      const bed = bedById(ctx, c.id);
      return bed ? { actions: [{ type: 'moveBed', id: bed.id, dx: c.dx, dy: c.dy }], result: { type: 'moveBed', bedId: bed.id } } : null;
    }
    case 'rotateBed': {
      const bed = bedById(ctx, c.id);
      return bed ? { actions: [{ type: 'rotateBed', id: bed.id, rotationDeg: c.rotationDeg }], result: { type: 'rotateBed', bedId: bed.id } } : null;
    }
    case 'reshapeBed':
      return reshapeBed(ctx, c);
    case 'removeBed': {
      const bed = bedById(ctx, c.id);
      if (!bed) return null;
      const actions: Action[] = [{ type: 'removeBed', id: bed.id }];
      return { actions, result: { type: 'removeBed', bedId: bed.id, removed: plantsIn(ctx, bed.id).map((p) => p.id) } };
    }
    case 'pasteBed':
      return pasteBed(ctx, c);
    case 'restoreLayout':
      return restoreLayout(ctx, c);
    case 'setGardenName':
      return { actions: [{ type: 'setGardenName', name: c.name }], result: { type: 'setGardenName' } };
    case 'setNorth':
      return { actions: [{ type: 'setNorth', northDeg: c.northDeg }], result: { type: 'setNorth' } };
    case 'setProfile':
      return setProfile(ctx, c);
  }
}
