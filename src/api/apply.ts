import { CROPS } from '../data/crops';
import type { Bed, GardenPlan, PlantInstance, Point } from '../types';
import { MAX_PATCH_PLANTS, clampGroupDelta, clampToOutline, gridPoints, isInsideOutline } from '../core/geometry';
import { bedOutline } from '../core/layout';
import { reducer, type Action } from '../core/reducer';
import { REF_PREFIX, type AddPatchCommand, type AddPlantCommand, type Command, type CommandType } from './commands';
import { revOf } from './rev';
import type { ApiError, WarningDiff } from './types';
import { computeWarnings, diffWarnings } from './warnings';

export interface ApplyOptions {
  /** Makes ids for new plants and patches; injected so callers (and tests) control them. */
  newId: () => string;
  /** Reject with `stale_revision` unless the plan is at this revision. */
  ifRev?: string;
  /** Compute and report everything but tell the caller not to commit. */
  dryRun?: boolean;
}

/** What one command did, in the order the commands were given. */
export interface CommandResult {
  type: CommandType;
  ref?: string;
  /** Plants the command created. */
  plantIds?: string[];
  /** The patch it created or acted on. */
  groupId?: string;
  /** Plants it removed. */
  removed?: string[];
  /** Points `clip` dropped for being outside the bed. */
  skipped?: Point[];
}

export type ApplyResult =
  | {
      ok: true;
      /** The plan after every command. With `dryRun` this is what committing would produce. */
      plan: GardenPlan;
      /** Revision of `plan`. */
      rev: string;
      /** False for a dry run: the caller must not store `plan`. */
      committed: boolean;
      results: CommandResult[];
      warnings: WarningDiff;
    }
  | { ok: false; errors: ApiError[] };

/** Most "outside the bed" errors reported for one command; the rest are summarized in one more. */
const MAX_POINT_ERRORS = 20;

type Ref = { kind: 'plant' | 'patch'; plantIds: string[]; groupId: string } | 'failed';

/** Everything a handler needs, and the one way it reports a problem. */
interface Ctx {
  plan: GardenPlan;
  at: string;
  newId: () => string;
  refs: Map<string, Ref>;
  report(e: Omit<ApiError, 'commandIndex'>): void;
}

/** A command's outcome: the reducer actions to run, and what to tell the caller. `null`: it failed. */
type Outcome = { actions: Action[]; result: CommandResult } | null;

const round = (n: number) => Math.round(n * 100) / 100;
const fmt = (p: Point) => `(${round(p.x)}, ${round(p.y)})`;

function findBed(ctx: Ctx, bedId: string, field = 'bedId'): Bed | null {
  const bed = ctx.plan.beds.find((b) => b.id === bedId);
  if (!bed) ctx.report({ code: 'unknown_bed', path: `${ctx.at}/${field}`, message: `There is no bed with id "${bedId}".`, details: { bedId } });
  return bed ?? null;
}

function checkCrop(ctx: Ctx, cropId: string) {
  const crop = CROPS.find((c) => c.id === cropId);
  if (!crop) ctx.report({ code: 'unknown_crop', path: `${ctx.at}/cropId`, message: `There is no crop with id "${cropId}".`, details: { cropId } });
  return crop ?? null;
}

/** What a `$ref` (or plain id) in `field` refers to: a literal id, a created object, or `failed`/`unknown`. */
function resolve(ctx: Ctx, value: string, field: string): { ref: Exclude<Ref, 'failed'> } | { id: string } | 'failed' | 'unknown' {
  if (!value.startsWith(REF_PREFIX)) return { id: value };
  const name = value.slice(REF_PREFIX.length);
  const ref = ctx.refs.get(name);
  if (!ref) {
    ctx.report({ code: 'unknown_id', path: `${ctx.at}/${field}`, message: `No earlier command in this batch has ref "${name}".`, details: { ref: name } });
    return 'unknown';
  }
  return ref === 'failed' ? 'failed' : { ref };
}

function plantTarget(ctx: Ctx, value: string, field: string): PlantInstance | null {
  const r = resolve(ctx, value, field);
  if (r === 'failed' || r === 'unknown') return null;
  let id: string;
  if ('ref' in r) {
    if (r.ref.kind !== 'plant') {
      ctx.report({ code: 'unknown_id', path: `${ctx.at}/${field}`, message: `"${value}" refers to a patch, not a single plant.` });
      return null;
    }
    id = r.ref.plantIds[0];
  } else id = r.id;
  const plant = ctx.plan.plants.find((p) => p.id === id);
  if (!plant) ctx.report({ code: 'unknown_id', path: `${ctx.at}/${field}`, message: `There is no plant with id "${id}".`, details: { id } });
  return plant ?? null;
}

function patchTarget(ctx: Ctx, value: string, field: string): { groupId: string; members: PlantInstance[] } | null {
  const r = resolve(ctx, value, field);
  if (r === 'failed' || r === 'unknown') return null;
  const groupId = 'ref' in r ? r.ref.groupId : r.id;
  const members = ctx.plan.plants.filter((p) => p.groupId === groupId);
  if (members.length === 0) {
    ctx.report({ code: 'unknown_id', path: `${ctx.at}/${field}`, message: `There is no patch or plant group with id "${groupId}".`, details: { groupId } });
    return null;
  }
  return { groupId, members };
}

function outsideError(ctx: Ctx, bed: Bed, p: Point, path: string): void {
  ctx.report({
    code: 'outside_bed',
    path,
    message: `Plant center ${fmt(p)} is outside bed "${bed.name}" (${round(bed.widthIn)}×${round(bed.heightIn)} in ${bed.shape}).`,
    details: { bedId: bed.id, point: p },
    suggestion: { nearestValidPoint: clampToOutline(p, bedOutline(bed)) },
  });
}

function instance(c: { cropId: string; variety?: string }, bedId: string, id: string, groupId: string, p: Point): PlantInstance {
  const plant: PlantInstance = { id, bedId, cropId: c.cropId, x: p.x, y: p.y, groupId };
  if (c.variety !== undefined) plant.variety = c.variety;
  return plant;
}

function claimRef(ctx: Ctx, ref: string | undefined, path: string): boolean {
  if (ref === undefined) return true;
  if (ctx.refs.has(ref)) {
    ctx.report({ code: 'duplicate_ref', path: `${ctx.at}/${path}`, message: `Ref "${ref}" is already used by an earlier command.`, details: { ref } });
    return false;
  }
  return true;
}

function addPlant(ctx: Ctx, c: AddPlantCommand): Outcome {
  const refOk = claimRef(ctx, c.ref, 'ref');
  const bed = findBed(ctx, c.bedId);
  const crop = checkCrop(ctx, c.cropId);
  if (!refOk || !bed || !crop) return null;

  const id = c.id ?? ctx.newId();
  const groupId = c.groupId ?? ctx.newId();
  let ok = true;
  if (ctx.plan.plants.some((p) => p.id === id)) {
    ctx.report({ code: 'duplicate_id', path: `${ctx.at}/id`, message: `A plant with id "${id}" already exists.`, details: { id } });
    ok = false;
  }
  const members = ctx.plan.plants.filter((p) => p.groupId === groupId);
  if (members.some((m) => m.bedId !== bed.id || m.cropId !== crop.id)) {
    ctx.report({
      code: 'duplicate_id',
      path: `${ctx.at}/groupId`,
      message: `Patch "${groupId}" already exists with a different bed or crop, so a ${crop.name} in "${bed.name}" can't join it.`,
      details: { groupId },
    });
    ok = false;
  }
  const at = { x: c.x, y: c.y };
  if (!isInsideOutline(at, bedOutline(bed))) {
    outsideError(ctx, bed, at, `${ctx.at}`);
    ok = false;
  }
  if (!ok) return null;
  if (c.ref !== undefined) ctx.refs.set(c.ref, { kind: 'plant', plantIds: [id], groupId });
  return { actions: [{ type: 'addPlants', plants: [instance(c, bed.id, id, groupId, at)] }], result: { type: 'addPlant', ref: c.ref, plantIds: [id], groupId } };
}

function addPatch(ctx: Ctx, c: AddPatchCommand): Outcome {
  const refOk = claimRef(ctx, c.ref, 'ref');
  const bed = findBed(ctx, c.bedId);
  const crop = checkCrop(ctx, c.cropId);
  if (!refOk || !bed || !crop) return null;

  let points: Point[];
  if (c.grid) {
    const { columns, rows } = c.grid;
    const bad = (field: string, n: number) => {
      ctx.report({ code: 'invalid_grid', path: `${ctx.at}/grid/${field}`, message: `grid.${field} must be a whole number of at least 1 (got ${n}).` });
    };
    if (!Number.isInteger(columns) || columns < 1) bad('columns', columns);
    if (!Number.isInteger(rows) || rows < 1) bad('rows', rows);
    if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) return null;
    if (columns * rows > MAX_PATCH_PLANTS) {
      ctx.report({
        code: 'invalid_grid',
        path: `${ctx.at}/grid`,
        message: `A ${columns}×${rows} grid is ${columns * rows} plants; a patch holds at most ${MAX_PATCH_PLANTS}.`,
        details: { max: MAX_PATCH_PLANTS },
      });
      return null;
    }
    points = gridPoints(c.grid.origin, c.grid.axis, columns, rows, crop.spacingIn);
  } else {
    points = c.points ?? [];
  }
  if (points.length === 0) {
    ctx.report({ code: 'empty_patch', path: `${ctx.at}/points`, message: 'A patch needs at least one point.' });
    return null;
  }

  const outline = bedOutline(bed);
  const kept: Point[] = [];
  const skipped: Point[] = [];
  let outside = 0;
  points.forEach((p, k) => {
    if (isInsideOutline(p, outline)) return void kept.push(p);
    if (c.clip) return void skipped.push(p);
    outside++;
    if (outside <= MAX_POINT_ERRORS) outsideError(ctx, bed, p, c.grid ? `${ctx.at}/grid#${k}` : `${ctx.at}/points/${k}`);
  });
  if (outside > MAX_POINT_ERRORS) {
    ctx.report({ code: 'outside_bed', path: `${ctx.at}`, message: `${outside - MAX_POINT_ERRORS} more points are outside the bed (${outside} of ${points.length} in all).`, details: { outside, total: points.length } });
  }
  if (outside > 0) return null;
  if (kept.length === 0) {
    ctx.report({ code: 'empty_patch', path: `${ctx.at}`, message: 'Every point is outside the bed, so there is nothing to plant.', details: { bedId: bed.id } });
    return null;
  }

  const groupId = c.groupId ?? ctx.newId();
  if (ctx.plan.plants.some((p) => p.groupId === groupId)) {
    ctx.report({ code: 'duplicate_id', path: `${ctx.at}/groupId`, message: `A patch with id "${groupId}" already exists.`, details: { groupId } });
    return null;
  }
  const plants = kept.map((p) => instance(c, bed.id, ctx.newId(), groupId, p));
  const plantIds = plants.map((p) => p.id);
  if (c.ref !== undefined) ctx.refs.set(c.ref, { kind: 'patch', plantIds, groupId });
  const result: CommandResult = { type: 'addPatch', ref: c.ref, plantIds, groupId };
  if (skipped.length) result.skipped = skipped;
  return { actions: [{ type: 'addPlants', plants }], result };
}

function movePatch(ctx: Ctx, c: Extract<Command, { type: 'movePatch' }>): Outcome {
  const target = patchTarget(ctx, c.groupId, 'groupId');
  if (!target) return null;
  const { groupId, members } = target;
  const bedOf = (m: PlantInstance) => ctx.plan.beds.find((b) => b.id === m.bedId);
  let ok = true;
  for (const m of members) {
    const bed = bedOf(m);
    const to = { x: m.x + c.dx, y: m.y + c.dy };
    if (!bed || isInsideOutline(to, bedOutline(bed))) continue;
    ok = false;
    break; // one is enough to say the move doesn't fit; the error below covers the whole patch
  }
  if (!ok) {
    const bed = bedOf(members[0])!;
    const fit = clampGroupDelta(members, c.dx, c.dy, bedOutline(bed));
    ctx.report({
      code: 'outside_bed',
      path: `${ctx.at}`,
      message: `Moving patch "${groupId}" by (${round(c.dx)}, ${round(c.dy)}) puts part of it outside "${bed.name}"; the furthest it can go that way is (${round(fit.x)}, ${round(fit.y)}).`,
      details: { groupId, dx: c.dx, dy: c.dy },
      suggestion: { dx: fit.x, dy: fit.y },
    });
    return null;
  }
  return { actions: [{ type: 'moveGroup', groupId, dx: c.dx, dy: c.dy }], result: { type: 'movePatch', groupId } };
}

function warningKey(ctx: Ctx, id: string): string | null {
  if (!computeWarnings(ctx.plan).some((w) => w.id === id)) {
    ctx.report({ code: 'unknown_id', path: `${ctx.at}/id`, message: `There is no current warning with id "${id}".`, details: { id } });
    return null;
  }
  return id.slice(id.indexOf(':') + 1); // only spacing warnings exist so far; their key is the conflict key
}

function applyOne(ctx: Ctx, c: Command): Outcome {
  switch (c.type) {
    case 'addPlant':
      return addPlant(ctx, c);
    case 'addPatch':
      return addPatch(ctx, c);
    case 'removePlant': {
      const plant = plantTarget(ctx, c.id, 'id');
      return plant ? { actions: [{ type: 'removePlant', id: plant.id }], result: { type: 'removePlant', removed: [plant.id], groupId: plant.groupId } } : null;
    }
    case 'removePatch': {
      const t = patchTarget(ctx, c.groupId, 'groupId');
      return t ? { actions: [{ type: 'removeGroup', groupId: t.groupId }], result: { type: 'removePatch', groupId: t.groupId, removed: t.members.map((m) => m.id) } } : null;
    }
    case 'movePatch':
      return movePatch(ctx, c);
    case 'setVariety': {
      const plant = plantTarget(ctx, c.id, 'id');
      return plant ? { actions: [{ type: 'setVariety', id: plant.id, variety: c.variety ?? undefined }], result: { type: 'setVariety' } } : null;
    }
    case 'dismissWarning':
    case 'restoreWarning': {
      const key = warningKey(ctx, c.id);
      return key === null ? null : { actions: [{ type: 'setConflictDismissed', key, dismissed: c.type === 'dismissWarning' }], result: { type: c.type } };
    }
  }
}

/**
 * Validates a batch of commands against a plan and applies them in order, each seeing the
 * effects of the ones before it. All or nothing: if any command is invalid the result lists every
 * error (with the index of its command) and no plan, so the caller's plan is untouched. On
 * success it returns the new plan, its revision, what each command did, and which warnings the
 * batch introduced and resolved. Pure: it never mutates `plan` and does no I/O; storing the new
 * plan (unless `dryRun`) is the caller's job.
 */
export function applyCommands(plan: GardenPlan, commands: Command[], options: ApplyOptions): ApplyResult {
  const current = revOf(plan);
  if (options.ifRev !== undefined && options.ifRev !== current) {
    return {
      ok: false,
      errors: [{ code: 'stale_revision', path: '/ifRev', message: 'The garden has changed since you read it; read it again and retry.', details: { rev: current } }],
    };
  }

  const errors: ApiError[] = [];
  const results: CommandResult[] = [];
  const refs = new Map<string, Ref>();
  let work = plan;

  commands.forEach((command, i) => {
    const ctx: Ctx = { plan: work, at: `/commands/${i}`, newId: options.newId, refs, report: (e) => errors.push({ ...e, commandIndex: i }) };
    const before = errors.length;
    const outcome = applyOne(ctx, command);
    if (!outcome) {
      // A failed command's ref stays claimed, so later commands using it are skipped quietly instead of piling on errors.
      const ref = 'ref' in command ? command.ref : undefined;
      if (ref !== undefined && !refs.has(ref)) refs.set(ref, 'failed');
      if (errors.length === before && !refsSkipped(command, refs)) {
        // Defensive: a handler must say why it failed.
        errors.push({ code: 'invalid_command', path: ctx.at, message: 'The command could not be applied.', commandIndex: i });
      }
      return;
    }
    work = outcome.actions.reduce(reducer, work);
    results.push(outcome.result);
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    plan: work,
    rev: revOf(work),
    committed: !options.dryRun,
    results,
    warnings: diffWarnings(computeWarnings(plan), computeWarnings(work)),
  };
}

/** Whether a command that failed without its own error did so only because it used a ref a failed command owns. */
function refsSkipped(command: Command, refs: Map<string, Ref>): boolean {
  const fields: (string | undefined)[] = [
    'id' in command ? command.id : undefined,
    'groupId' in command ? command.groupId : undefined,
  ];
  return fields.some((f) => f?.startsWith(REF_PREFIX) && refs.get(f.slice(REF_PREFIX.length)) === 'failed');
}
