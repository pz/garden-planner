import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';

// The "adjust the plan" request: what a gardener asks for in the crops list before asking for a
// suggestion. Pure state transitions, so every rule about what an arrow, a typed number or a
// cross does lives here and is tested in Node, and the card only wires events to them.
//
// A request on a crop is one of three things:
//   more / fewer  a soft direction: the suggestion decides how many. The row's count never changes.
//   exact         a target total in the scope (0 means take the crop out).
// Arrows and typing use different parts of a row, so they cannot be confused: an arrow marks a
// direction (and, once a target exists, steps it by one); only typing sets a number from nothing.

export type CropRequest = { kind: 'more' } | { kind: 'fewer' } | { kind: 'exact'; target: number };

export interface AdjustRequests {
  /** What was asked of each crop, by crop id. */
  requests: Readonly<Record<string, CropRequest>>;
  /** Crops added to the request that have no plants in the scope yet, in the order added. */
  added: readonly string[];
}

export const NO_REQUESTS: AdjustRequests = { requests: {}, added: [] };

/** The largest target a gardener can type. */
export const MAX_TARGET = 999;

export interface CropCount {
  cropId: string;
  count: number;
}

/** Plants per crop (crops with none are left out), most first, then by name; only one bed's plants if `bedId` is given. */
export function cropCounts(plants: readonly PlantInstance[], bedId?: string): CropCount[] {
  const counts = new Map<string, number>();
  for (const p of plants) {
    if (bedId !== undefined && p.bedId !== bedId) continue;
    counts.set(p.cropId, (counts.get(p.cropId) ?? 0) + 1);
  }
  return [...counts]
    .map(([cropId, count]) => ({ cropId, count }))
    .sort((a, b) => b.count - a.count || getCrop(a.cropId).name.localeCompare(getCrop(b.cropId).name));
}

export interface AdjustRow extends CropCount {
  request: CropRequest | undefined;
  /** Added to the request and not planted in the scope yet. */
  isNew: boolean;
}

/** The rows the crops list shows: each crop in the scope, then the crops added to the request. */
export function adjustRows(plants: readonly PlantInstance[], state: AdjustRequests, bedId?: string): AdjustRow[] {
  const counts = cropCounts(plants, bedId);
  const rows: AdjustRow[] = counts.map((c) => ({ ...c, request: state.requests[c.cropId], isNew: false }));
  const present = new Set(counts.map((c) => c.cropId));
  for (const cropId of state.added) if (!present.has(cropId)) rows.push({ cropId, count: 0, request: state.requests[cropId], isNew: true });
  return rows;
}

/** How many rows carry a request: the number on the Suggest button. */
export function changeCount(rows: readonly AdjustRow[]): number {
  return rows.filter((r) => r.request !== undefined).length;
}

function withRequest(state: AdjustRequests, cropId: string, request: CropRequest | undefined): AdjustRequests {
  const requests = { ...state.requests };
  if (request) requests[cropId] = request;
  else delete requests[cropId];
  return { ...state, requests };
}

/**
 * The up or down arrow on a row whose crop has `count` plants. With no request it marks a soft
 * direction (fewer needs something to take away); on a soft request the same arrow leaves it and
 * the other arrow clears it; on a target it steps the target by one, and landing on the current
 * count means no request at all.
 */
export function pressArrow(state: AdjustRequests, cropId: string, count: number, dir: 'more' | 'fewer'): AdjustRequests {
  const req = state.requests[cropId];
  if (req?.kind === 'exact') {
    const target = Math.min(MAX_TARGET, Math.max(0, req.target + (dir === 'more' ? 1 : -1)));
    return withRequest(state, cropId, target === count ? undefined : { kind: 'exact', target });
  }
  if (req) return req.kind === dir ? state : withRequest(state, cropId, undefined);
  if (dir === 'fewer' && count === 0) return state;
  return withRequest(state, cropId, { kind: dir });
}

/** Parses what was typed in a row's count: a whole number from 0 to `MAX_TARGET`, or null. */
export function parseTarget(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_TARGET ? n : null;
}

/** A number typed in a row whose crop has `count` plants: an exact target, replacing any soft request. Typing the current count asks for nothing. */
export function typeTarget(state: AdjustRequests, cropId: string, count: number, text: string): AdjustRequests {
  const n = parseTarget(text);
  if (n === null) return state;
  return withRequest(state, cropId, n === count ? undefined : { kind: 'exact', target: n });
}

/** The cross on a row: drops its request; on a crop that was only added to the request it drops the row too. */
export function clearRow(state: AdjustRequests, cropId: string, count: number): AdjustRequests {
  const next = withRequest(state, cropId, undefined);
  return count === 0 ? { ...next, added: next.added.filter((id) => id !== cropId) } : next;
}

/** "+ Add a crop": a new row, already asking for more than none. */
export function addCrop(state: AdjustRequests, cropId: string): AdjustRequests {
  const added = state.added.includes(cropId) ? state.added : [...state.added, cropId];
  return withRequest({ ...state, added }, cropId, { kind: 'more' });
}

/** Reset: no requests, no added rows. */
export const resetRequests = (): AdjustRequests => NO_REQUESTS;

/** What one row asks for, in the order the rows are shown, for a suggestion to work from. */
export interface Want {
  cropId: string;
  request: CropRequest;
}

export function wantsOf(rows: readonly AdjustRow[]): Want[] {
  return rows.flatMap((r) => (r.request ? [{ cropId: r.cropId, request: r.request }] : []));
}
