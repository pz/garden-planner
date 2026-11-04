import { describe, expect, it } from 'vitest';
import { createPlan } from '../core/reducer';
import { solveFromText, newPlantIds, tracePoints } from './session';

describe('solveFromText', () => {
  const plan = createPlan('t');
  it('reports bad JSON as one error', () => {
    const r = solveFromText(plan, '{ nope', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([expect.objectContaining({ code: 'invalid_command', path: '' })]);
  });
  it('reports every spec error', () => {
    const r = solveFromText(plan, JSON.stringify({ mode: 'x', demands: [{ cropId: 'ghost', weight: 1 }] }), {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(['/mode', '/demands/0/cropId']);
  });
  it('solves a valid spec', () => {
    const r = solveFromText(plan, JSON.stringify({ mode: 'fill', demands: [{ cropId: 'lettuce', weight: 1 }] }), { iterations: 50, year: 2026 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.commands.length).toBeGreaterThan(0);
      expect(newPlantIds(plan, r.proposal.plan).size).toBe(r.proposal.plan.plants.length);
    }
  });
});

describe('tracePoints', () => {
  it('is empty for fewer than two points', () => {
    expect(tracePoints([], 100, 50)).toBe('');
    expect(tracePoints([{ iteration: 0, score: 1 }], 100, 50)).toBe('');
  });
  it('puts the first iteration at the left and the last at the right, the best score at the top', () => {
    expect(tracePoints([{ iteration: 0, score: 1 }, { iteration: 50, score: 3 }, { iteration: 100, score: 2 }], 100, 40)).toBe('0,40 50,0 100,20');
  });
  it('draws a flat trace in the middle', () => {
    expect(tracePoints([{ iteration: 0, score: 2 }, { iteration: 10, score: 2 }], 10, 40)).toBe('0,20 10,20');
  });
});
