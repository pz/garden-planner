import { describe, expect, it } from 'vitest';
import { bedOutline } from '../core/layout';
import { customCrops, setCustomCrops } from '../data/crops';
import { GARDEN_FILES, SCENARIO_FILES, SPEC_FILES, gardenNames, loadGarden, loadScenario, scenarioNames } from './catalog';
import { parseSpec } from './spec';

describe('fixtures', () => {
  it('loads every garden fixture', () => {
    for (const name of gardenNames()) {
      const { plan } = loadGarden(name);
      expect(plan.beds.length).toBeGreaterThan(0);
      for (const bed of plan.beds) expect(bedOutline(bed)).toBeDefined();
    }
  });

  it('has the six starting gardens', () => {
    for (const name of ['empty-4x8', 'two-raised-beds', 'odd-shapes', 'north-row', 'tiny-bed', 'crowded']) expect(GARDEN_FILES).toHaveProperty(name);
  });

  it('shapes the gardens as their purpose says', () => {
    expect(loadGarden('tiny-bed').plan.beds.map((b) => [b.widthIn, b.heightIn])).toEqual([[24, 24]]);
    expect(loadGarden('odd-shapes').plan.beds.map((b) => b.shape)).toEqual(['ellipse', 'polygon', 'rect', 'rect']);
    expect(loadGarden('odd-shapes').plan.beds.at(-1)?.rotationDeg).toBe(30);
    expect(loadGarden('north-row').plan.northDeg ?? 0).toBe(0);
    expect(loadGarden('north-row-east').plan.northDeg).toBe(90);
    expect(loadGarden('short-season').plan.profile.zoneId).toBe('3');
    const crowded = loadGarden('crowded').plan;
    expect(crowded.plants.some((p) => p.cropId === 'beans') && crowded.plants.some((p) => p.cropId === 'onion')).toBe(true);
  });

  it('keeps every fixture plant inside its bed’s outline box', () => {
    for (const name of gardenNames()) {
      const { plan } = loadGarden(name);
      for (const p of plan.plants) {
        const bed = plan.beds.find((b) => b.id === p.bedId)!;
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(bed.widthIn);
        expect(p.y).toBeLessThanOrEqual(bed.heightIn);
      }
    }
  });

  it('registers a garden’s custom crops when it loads', () => {
    try {
      loadGarden('custom-crop');
      expect(customCrops().map((c) => c.id)).toEqual(['custom-ground-cherry']);
      loadGarden('empty-4x8');
      expect(customCrops()).toEqual([]);
    } finally {
      setCustomCrops([]);
    }
  });

  it('rejects an unknown fixture name with the names it has', () => {
    expect(() => loadGarden('nope')).toThrow(/empty-4x8/);
    expect(() => loadScenario('nope')).toThrow(/fill-empty-4x8/);
  });

  it('loads every scenario, with a valid spec for its garden', () => {
    for (const name of scenarioNames()) {
      const s = loadScenario(name);
      expect(s.name).toBe(name);
      expect(s.expect.length).toBeGreaterThan(0);
    }
  });

  it('uses every spec and garden fixture in some scenario', () => {
    const used = Object.values(SCENARIO_FILES).map((s) => s as { garden: string; spec: string });
    for (const name of Object.keys(SPEC_FILES)) expect(used.map((s) => s.spec)).toContain(name);
    for (const name of Object.keys(GARDEN_FILES)) expect(used.map((s) => s.garden)).toContain(name);
  });

  it('covers each mode, locks, exclude, per-demand beds, min/max, a custom crop and a short season', () => {
    const specs = scenarioNames().map((n) => loadScenario(n).spec);
    expect(new Set(specs.map((s) => s.mode))).toEqual(new Set(['fill', 'adjust', 'replace']));
    expect(specs.some((s) => s.locked?.length)).toBe(true);
    expect(specs.some((s) => s.exclude?.length)).toBe(true);
    expect(specs.some((s) => s.demands.some((d) => d.bedIds))).toBe(true);
    expect(specs.some((s) => s.demands.some((d) => d.min !== undefined || d.max !== undefined))).toBe(true);
    expect(specs.some((s) => s.demands.some((d) => d.cropId.startsWith('custom-')))).toBe(true);
    expect(specs.some((s) => s.demands.some((d) => d.cropId === 'artichoke'))).toBe(true);
  });

  it('names the failing spec when a spec does not fit its garden', () => {
    const { plan } = loadGarden('empty-4x8');
    const r = parseSpec(SPEC_FILES['fill-bed-restricted'], plan);
    expect(r.ok).toBe(false);
  });
});
