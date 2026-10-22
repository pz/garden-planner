import type { GardenLine, Point } from '../types';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (p: unknown): p is Point => typeof p === 'object' && p !== null && isNum((p as Point).x) && isNum((p as Point).y);

/** Whether a stored line is complete: an id and two finite end points that differ. */
export function isValidLine(l: unknown): l is GardenLine {
  if (typeof l !== 'object' || l === null) return false;
  const line = l as Partial<GardenLine>;
  if (typeof line.id !== 'string' || !line.id || !isPoint(line.a) || !isPoint(line.b)) return false;
  return line.a.x !== line.b.x || line.a.y !== line.b.y;
}

/** The usable lines of a stored list: malformed ones, and repeats of an earlier id, are dropped. */
export function cleanLines(raw: unknown): GardenLine[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: GardenLine[] = [];
  for (const l of raw) {
    if (!isValidLine(l) || seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ id: l.id, a: { x: l.a.x, y: l.a.y }, b: { x: l.b.x, y: l.b.y } });
  }
  return out;
}

export function lineLengthIn(l: Pick<GardenLine, 'a' | 'b'>): number {
  return Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
}
