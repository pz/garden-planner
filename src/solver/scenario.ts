import type { ApiError } from '../api/types';
import type { WarningKind, WarningSeverity } from '../api/types';

// A scenario pairs a garden fixture with a spec fixture, run settings, and what the result must
// satisfy. Fixtures are plain JSON, so a garden exported from the app can be dropped straight in.

export type CropStatus = 'met' | 'partial' | 'unmet';
export const CROP_STATUSES: readonly CropStatus[] = ['met', 'partial', 'unmet'];

export const UNMET_REASONS = ['season_too_short', 'insufficient_space', 'insufficient_sun', 'outcompeted', 'limited_by_bed_restriction'] as const;
export type UnmetReason = (typeof UNMET_REASONS)[number];

export type Expectation =
  /** Plants of `crop` the proposal ends up with in the whole garden: at least `gte`, at most `lte`, exactly `eq`. */
  | { kind: 'placed'; crop: string; gte?: number; lte?: number; eq?: number }
  | { kind: 'status'; crop: string; status: CropStatus; reason?: UnmetReason }
  /** At most `max` warnings the proposal introduces, of this kind (and severity, when given). */
  | { kind: 'introducedWarnings'; warningKind: WarningKind; severity?: WarningSeverity; max: number }
  /** Patches whose plants are identical before and after. */
  | { kind: 'unchanged'; groupIds: string[] }
  /** Patches that no longer exist after. */
  | { kind: 'removed'; groupIds: string[] }
  /** Every plant of `crop` is in one of these beds. */
  | { kind: 'inBeds'; crop: string; bedIds: string[] }
  | { kind: 'score'; gte: number };

export interface ScenarioRunOptions {
  seed?: number;
  iterations?: number;
}

export interface Scenario {
  description?: string;
  /** Name of a garden fixture. */
  garden: string;
  /** Name of a spec fixture. */
  spec: string;
  options?: ScenarioRunOptions;
  expect: Expectation[];
}

export type ParsedScenario = { ok: true; scenario: Scenario } | { ok: false; errors: ApiError[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const KINDS: Record<Expectation['kind'], readonly string[]> = {
  placed: ['kind', 'crop', 'gte', 'lte', 'eq'],
  status: ['kind', 'crop', 'status', 'reason'],
  introducedWarnings: ['kind', 'warningKind', 'severity', 'max'],
  unchanged: ['kind', 'groupIds'],
  removed: ['kind', 'groupIds'],
  inBeds: ['kind', 'crop', 'bedIds'],
  score: ['kind', 'gte'],
};

/** Validates a scenario file's JSON. Unknown expectation kinds and unknown fields are errors, so a typo can't make a check silently vanish. */
export function parseScenario(raw: unknown): ParsedScenario {
  const errors: ApiError[] = [];
  const bad = (path: string, message: string) => errors.push({ code: 'invalid_command', path, message: `${path || '/'} ${message}` });
  if (!isRecord(raw)) return { ok: false, errors: [{ code: 'invalid_command', path: '', message: 'A scenario must be a JSON object.' }] };

  for (const k of Object.keys(raw)) if (!['description', 'garden', 'spec', 'options', 'expect'].includes(k)) bad(`/${k}`, 'is not a known field');
  for (const k of ['garden', 'spec'] as const) {
    if (raw[k] === undefined) bad(`/${k}`, 'is required');
    else if (typeof raw[k] !== 'string' || raw[k] === '') bad(`/${k}`, 'must be a fixture name');
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') bad('/description', 'must be a string');

  if (raw.options !== undefined) {
    if (!isRecord(raw.options)) bad('/options', 'must be an object');
    else {
      for (const k of Object.keys(raw.options)) if (!['seed', 'iterations'].includes(k)) bad(`/options/${k}`, 'is not a known field');
      const { seed, iterations } = raw.options;
      if (seed !== undefined && !(typeof seed === 'number' && Number.isInteger(seed))) bad('/options/seed', 'must be a whole number');
      if (iterations !== undefined && !(typeof iterations === 'number' && Number.isInteger(iterations) && iterations >= 0)) bad('/options/iterations', 'must be a whole number, 0 or more');
    }
  }

  if (!Array.isArray(raw.expect)) bad('/expect', 'must be an array of expectations');
  else {
    raw.expect.forEach((e, i) => {
      const at = `/expect/${i}`;
      if (!isRecord(e)) return bad(at, 'must be an object');
      if (typeof e.kind !== 'string' || !Object.hasOwn(KINDS, e.kind)) return bad(`${at}/kind`, `must be one of ${Object.keys(KINDS).join(', ')}`);
      const kind = e.kind as Expectation['kind'];
      for (const k of Object.keys(e)) if (!KINDS[kind].includes(k)) bad(`${at}/${k}`, `is not a field of a "${kind}" expectation`);
      const str = (k: string) => {
        if (typeof e[k] !== 'string' || e[k] === '') bad(`${at}/${k}`, 'must be a non-empty string');
      };
      const num = (k: string, required = false) => {
        if (e[k] === undefined) return required ? bad(`${at}/${k}`, 'is required') : undefined;
        if (typeof e[k] !== 'number' || !Number.isFinite(e[k])) bad(`${at}/${k}`, 'must be a number');
      };
      const ids = (k: string) => {
        if (!Array.isArray(e[k]) || e[k].length === 0 || e[k].some((s) => typeof s !== 'string' || s === '')) bad(`${at}/${k}`, 'must be a non-empty array of ids');
      };
      switch (kind) {
        case 'placed':
          str('crop');
          num('gte');
          num('lte');
          num('eq');
          if (e.gte === undefined && e.lte === undefined && e.eq === undefined) bad(at, 'needs at least one of gte, lte, eq');
          break;
        case 'status':
          str('crop');
          if (!CROP_STATUSES.includes(e.status as CropStatus)) bad(`${at}/status`, `must be one of ${CROP_STATUSES.join(', ')}`);
          if (e.reason !== undefined && !UNMET_REASONS.includes(e.reason as UnmetReason)) bad(`${at}/reason`, `must be one of ${UNMET_REASONS.join(', ')}`);
          break;
        case 'introducedWarnings':
          if (!['spacing', 'shade', 'companion'].includes(e.warningKind as string)) bad(`${at}/warningKind`, 'must be one of spacing, shade, companion');
          if (e.severity !== undefined && !['caution', 'problem'].includes(e.severity as string)) bad(`${at}/severity`, 'must be caution or problem');
          num('max', true);
          break;
        case 'unchanged':
        case 'removed':
          ids('groupIds');
          break;
        case 'inBeds':
          str('crop');
          ids('bedIds');
          break;
        case 'score':
          num('gte', true);
          break;
      }
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, scenario: raw as unknown as Scenario };
}
