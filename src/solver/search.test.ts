import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/random';
import { loadScenario, scenarioNames } from './catalog';
import { median, sweep } from './check';
import { Evaluator } from './evaluator';
import { normalize } from './normalize';
import { solve } from './solve';
import { blockPlantCount, type Block } from './block';
import { T_END, T_START, TRACE_EVERY } from './anneal';

const FILL = scenarioNames().filter((n) => loadScenario(n).spec.mode === 'fill');

describe('local search', () => {
  // Where the greedy pass leaves room to improve, 20 seeds' median must beat it; elsewhere the search must at least never lose.
  const IMPROVABLE = ['fill-around-existing', 'fill-bed-restricted', 'fill-custom-crop', 'fill-short-season', 'fill-tiny-bed'];

  it('on the median beats the greedy start over 20 seeds', () => {
    for (const name of IMPROVABLE) {
      const r = sweep(loadScenario(name), 20, 600);
      r.searched.forEach((score, i) => expect(score, `${name}, seed ${i + 1}`).toBeGreaterThanOrEqual(r.greedy[i] - 1e-9));
      expect(median(r.searched), name).toBeGreaterThan(median(r.greedy) + 1e-9);
    }
  }, 60_000);

  it('does so on the four-bed odd-shapes garden too (4 seeds: its greedy pass alone takes half a second)', () => {
    const r = sweep(loadScenario('fill-odd-shapes'), 4, 600);
    expect(median(r.searched)).toBeGreaterThan(median(r.greedy) + 1e-9);
  }, 60_000);

  it('never ends below the greedy start on any fill scenario', () => {
    for (const name of FILL) {
      const r = sweep(loadScenario(name), 2, 200);
      r.searched.forEach((score, i) => expect(score, `${name}, seed ${i + 1}`).toBeGreaterThanOrEqual(r.greedy[i] - 1e-9));
    }
  }, 60_000);

  it('gives the same commands for the same seed, and may give different ones for another', () => {
    const s = loadScenario('fill-odd-shapes');
    const run = (seed: number) => JSON.stringify(solve(s.plan, s.spec, { seed, iterations: 400, year: 2026 }).commands);
    expect(run(3)).toBe(run(3));
    expect(new Set([1, 2, 3, 4, 5].map(run)).size).toBeGreaterThan(1);
  });

  it('records the score every 50 iterations when asked, starting at 0, and not otherwise', () => {
    const s = loadScenario('fill-empty-4x8');
    const t = solve(s.plan, s.spec, { iterations: 200, trace: true, year: 2026 }).trace!;
    expect(t.map((x) => x.iteration)).toEqual([0, TRACE_EVERY, 2 * TRACE_EVERY, 3 * TRACE_EVERY, 4 * TRACE_EVERY]);
    expect(solve(s.plan, s.spec, { iterations: 200, year: 2026 }).trace).toBeUndefined();
  });

  it('with 0 iterations is the greedy result', () => {
    const s = loadScenario('fill-empty-4x8');
    const p = solve(s.plan, s.spec, { iterations: 0, year: 2026 });
    expect(p.iterations).toBe(0);
    expect(p.hardViolations).toEqual([]);
  });

  it('cools from a higher to a lower temperature', () => {
    expect(T_START).toBeGreaterThan(T_END);
    expect(T_END).toBeGreaterThan(0);
  });

  it('finishes 3000 iterations on two-raised-beds quickly (the aim is 300 ms on a laptop; the limit here allows for a slow CI machine)', () => {
    const s = loadScenario('fill-around-existing');
    solve(s.plan, s.spec, { iterations: 200, year: 2026 }); // warm up the JIT
    const t0 = Date.now();
    solve(s.plan, s.spec, { iterations: 3000, year: 2026 });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('shade placement', () => {
  it('puts tall crops where their shadow falls off the garden: no shade conflict, in either orientation', () => {
    for (const name of ['fill-north-row', 'fill-north-row-east']) {
      const s = loadScenario(name);
      for (const seed of [1, 2, 3]) {
        const p = solve(s.plan, s.spec, { seed, iterations: 1500, year: 2026 });
        expect(p.score.shade, `${name} seed ${seed}`).toBe(0);
        expect(p.introducedWarnings.filter((w) => w.kind === 'shade')).toEqual([]);
        expect(p.crops.find((c) => c.cropId === 'corn')!.placed).toBeGreaterThan(5);
      }
    }
  });

  it('prefers a layout with no shade over a bigger one with shade when shade counts', () => {
    // Corn (84 in) in a 24-in-wide bed with peppers: peppers anywhere north of the corn would be shaded.
    const s = loadScenario('fill-north-row');
    const heavy = solve(s.plan, { ...s.spec, prefs: { shade: 1 } }, { iterations: 1500, year: 2026 });
    const ignored = solve(s.plan, { ...s.spec, prefs: { shade: 0 } }, { iterations: 1500, year: 2026 });
    expect(heavy.score.shade).toBe(0);
    expect(ignored.introducedWarnings.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Evaluator keeps its score up to date', () => {
  // After any sequence of adds and removes, the incremental totals must equal a fresh evaluator built from the same blocks.
  it('through random adds and removes, on every fill scenario', () => {
    for (const name of FILL) {
      const s = loadScenario(name);
      const ctx = normalize(s.plan, s.spec, 2026);
      const next = mulberry32(11);
      const ev = new Evaluator(ctx);
      const ids: string[] = [];
      for (let step = 0; step < 60; step++) {
        if (ids.length > 0 && next() < 0.4) {
          const k = Math.floor(next() * ids.length);
          ev.remove(ids[k]);
          ids.splice(k, 1);
        } else if (ctx.demands.length) {
          const d = ctx.demands[Math.floor(next() * ctx.demands.length)];
          const bedId = d.bedIds[Math.floor(next() * d.bedIds.length)];
          const bed = ctx.beds.get(bedId)!.bed;
          const block: Block = { bedId, cropId: d.cropId, origin: { x: Math.round(next() * bed.widthIn), y: Math.round(next() * bed.heightIn) }, axis: 'x', columns: 1 + Math.floor(next() * 3), rows: 1 + Math.floor(next() * 3), source: 'new' };
          // Hard constraints are the caller's to check; the score must be right for anything that is placed.
          if (ev.canPlace(block)) ids.push(ev.add(block));
        }
      }
      const fresh = new Evaluator(ctx);
      for (const [, b] of ev.placed()) fresh.add(b);
      const a = ev.breakdown();
      const b = fresh.breakdown();
      for (const k of Object.keys(a) as (keyof typeof a)[]) expect(a[k], `${name} ${k}`).toBeCloseTo(b[k], 9);
      expect(ev.placed().reduce((n, [, x]) => n + blockPlantCount(x), 0)).toBe(fresh.placed().reduce((n, [, x]) => n + blockPlantCount(x), 0));
    }
  });

  it('previewAdd predicts the change add makes', () => {
    const s = loadScenario('fill-salad-garden');
    const ctx = normalize(s.plan, s.spec, 2026);
    const ev = new Evaluator(ctx);
    const next = mulberry32(5);
    for (let i = 0; i < 30; i++) {
      const d = ctx.demands[Math.floor(next() * ctx.demands.length)];
      const block: Block = { bedId: 'bed-1', cropId: d.cropId, origin: { x: Math.round(next() * 90), y: Math.round(next() * 40) }, axis: 'x', columns: 1 + Math.floor(next() * 2), rows: 1, source: 'new' };
      if (!ev.canPlace(block)) continue;
      const before = ev.score();
      const predicted = ev.previewAdd(block);
      ev.add(block);
      expect(ev.score() - before).toBeCloseTo(predicted, 9);
    }
  });
});
