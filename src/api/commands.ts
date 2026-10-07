import type { Point } from '../types';
import type { ApiError } from './types';

/** `$name` in an id field refers to the object an earlier command in the same batch created with `ref: "name"`. */
export const REF_PREFIX = '$';

export interface PatchGrid {
  origin: Point;
  /** `x`: columns run left to right and rows step downward; `y`: columns run downward and rows step rightward. */
  axis: 'x' | 'y';
  columns: number;
  rows: number;
}

export interface AddPlantCommand {
  type: 'addPlant';
  /** Names the new plant for later commands in the batch (`$ref`). */
  ref?: string;
  /** Normally generated; supply one to restore a plant under its old id. */
  id?: string;
  /** Normally a fresh one (a solo plant is a patch of one); supply an existing one to join that patch (same bed and crop). */
  groupId?: string;
  bedId: string;
  cropId: string;
  x: number;
  y: number;
  variety?: string;
}

export interface AddPatchCommand {
  type: 'addPatch';
  ref?: string;
  groupId?: string;
  bedId: string;
  cropId: string;
  /** Exactly one of `points` and `grid`. Points are in the bed's own frame, in inches. */
  points?: Point[];
  grid?: PatchGrid;
  variety?: string;
  /** Silently drop points outside the bed (reported as `skipped`) instead of rejecting the command. */
  clip?: boolean;
}

export interface RemovePlantCommand {
  type: 'removePlant';
  id: string;
}
export interface RemovePatchCommand {
  type: 'removePatch';
  groupId: string;
}
export interface MovePatchCommand {
  type: 'movePatch';
  groupId: string;
  dx: number;
  dy: number;
}
export interface SetVarietyCommand {
  type: 'setVariety';
  id: string;
  /** `null` clears it. */
  variety: string | null;
}
export interface DismissWarningCommand {
  type: 'dismissWarning';
  id: string;
}
export interface RestoreWarningCommand {
  type: 'restoreWarning';
  id: string;
}

export type Command =
  | AddPlantCommand
  | AddPatchCommand
  | RemovePlantCommand
  | RemovePatchCommand
  | MovePatchCommand
  | SetVarietyCommand
  | DismissWarningCommand
  | RestoreWarningCommand;

export type CommandType = Command['type'];

/** The body of a write request. */
export interface CommandRequest {
  commands: Command[];
  /** Reject with `stale_revision` unless the garden is still at this revision. */
  ifRev?: string;
  /** For the transport to deduplicate retries; `applyCommands` itself doesn't use it. */
  idempotencyKey?: string;
  /** Report what would happen without committing it. */
  dryRun?: boolean;
}

export type ParsedRequest = { ok: true; request: CommandRequest } | { ok: false; errors: ApiError[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const REF_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

type Check = (value: unknown, path: string, fail: (path: string, message: string) => void) => void;

const str: Check = (v, path, fail) => {
  if (!isNonEmptyString(v)) fail(path, 'must be a non-empty string');
};
const num: Check = (v, path, fail) => {
  if (!isFiniteNumber(v)) fail(path, 'must be a finite number');
};
const bool: Check = (v, path, fail) => {
  if (typeof v !== 'boolean') fail(path, 'must be true or false');
};
const refName: Check = (v, path, fail) => {
  if (typeof v !== 'string' || !REF_NAME.test(v)) fail(path, 'must be a name of letters, digits, "_" or "-", starting with a letter');
};
const nullableStr: Check = (v, path, fail) => {
  if (v !== null && typeof v !== 'string') fail(path, 'must be a string, or null to clear');
};
const point: Check = (v, path, fail) => {
  if (!isRecord(v) || !isFiniteNumber(v.x) || !isFiniteNumber(v.y)) fail(path, 'must be a point {x, y} of finite numbers');
};
const points: Check = (v, path, fail) => {
  if (!Array.isArray(v)) return fail(path, 'must be an array of points');
  v.forEach((p, i) => point(p, `${path}/${i}`, fail));
};
const grid: Check = (v, path, fail) => {
  if (!isRecord(v)) return fail(path, 'must be {origin, axis, columns, rows}');
  point(v.origin, `${path}/origin`, fail);
  if (v.axis !== 'x' && v.axis !== 'y') fail(`${path}/axis`, 'must be "x" or "y"');
  num(v.columns, `${path}/columns`, fail);
  num(v.rows, `${path}/rows`, fail);
  for (const k of Object.keys(v)) if (!['origin', 'axis', 'columns', 'rows'].includes(k)) fail(`${path}/${k}`, 'is not a known field');
};

/** Per command type: its fields, each with its check; `required` ones must be present. */
const SCHEMA: Record<CommandType, { required: Record<string, Check>; optional: Record<string, Check> }> = {
  addPlant: {
    required: { bedId: str, cropId: str, x: num, y: num },
    optional: { ref: refName, id: str, groupId: str, variety: str },
  },
  addPatch: {
    required: { bedId: str, cropId: str },
    optional: { ref: refName, groupId: str, points, grid, variety: str, clip: bool },
  },
  removePlant: { required: { id: str }, optional: {} },
  removePatch: { required: { groupId: str }, optional: {} },
  movePatch: { required: { groupId: str, dx: num, dy: num }, optional: {} },
  setVariety: { required: { id: str, variety: nullableStr }, optional: {} },
  dismissWarning: { required: { id: str }, optional: {} },
  restoreWarning: { required: { id: str }, optional: {} },
};

/**
 * Checks that untrusted JSON is a well-formed command batch: known commands, the right fields
 * with the right types, and no unknown fields (a misspelt field is reported rather than silently
 * ignored). It does not check the batch against any garden; that is `applyCommands`' job. Every
 * problem is reported, with a JSON pointer into the request.
 */
export function parseRequest(raw: unknown): ParsedRequest {
  const errors: ApiError[] = [];
  const fail = (path: string, message: string) => errors.push({ code: 'invalid_command', path, message: `${path || '/'} ${message}` });

  if (!isRecord(raw)) return { ok: false, errors: [{ code: 'invalid_command', path: '', message: 'The request must be a JSON object.' }] };
  for (const k of Object.keys(raw)) {
    if (!['commands', 'ifRev', 'idempotencyKey', 'dryRun'].includes(k)) fail(`/${k}`, 'is not a known field');
  }
  if (raw.ifRev !== undefined) str(raw.ifRev, '/ifRev', fail);
  if (raw.idempotencyKey !== undefined) str(raw.idempotencyKey, '/idempotencyKey', fail);
  if (raw.dryRun !== undefined) bool(raw.dryRun, '/dryRun', fail);

  if (!Array.isArray(raw.commands)) {
    fail('/commands', 'must be an array of commands');
  } else {
    raw.commands.forEach((c, i) => {
      const at = `/commands/${i}`;
      if (!isRecord(c)) return fail(at, 'must be an object');
      const spec = typeof c.type === 'string' && Object.hasOwn(SCHEMA, c.type) ? SCHEMA[c.type as CommandType] : null;
      if (!spec) return fail(`${at}/type`, `must be one of ${Object.keys(SCHEMA).join(', ')}`);
      for (const [k, check] of Object.entries(spec.required)) {
        if (c[k] === undefined) fail(`${at}/${k}`, 'is required');
        else check(c[k], `${at}/${k}`, fail);
      }
      for (const [k, check] of Object.entries(spec.optional)) {
        if (c[k] !== undefined) check(c[k], `${at}/${k}`, fail);
      }
      for (const k of Object.keys(c)) {
        if (k !== 'type' && !(k in spec.required) && !(k in spec.optional)) fail(`${at}/${k}`, 'is not a field of this command');
      }
      if (c.type === 'addPatch' && (c.points === undefined) === (c.grid === undefined)) {
        fail(at, 'needs exactly one of "points" and "grid"');
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, request: raw as unknown as CommandRequest };
}
