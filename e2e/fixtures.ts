import { expect, test as base, type Page } from '@playwright/test';
import type { Command } from '../src/api/commands';
import type { MockGardenApi, RecordedCall } from '../src/api/mockGardenApi';
import type { ApiError, Warning } from '../src/api/types';
import type { GardenPlan, PlantInstance } from '../src/types';

export const GARDEN_ID = 'g1';
const INDEX_KEY = 'garden-planner-index/v1';
export const planKey = (id: string) => `garden-planner-plan:${id}`;

/** A saved 8′ × 4′ garden with one bed, "bed-1", and the given plants. */
export function gardenWith(plants: Partial<PlantInstance>[] = []): GardenPlan {
  return {
    version: 3,
    id: GARDEN_ID,
    name: 'Test garden',
    profile: { zoneId: '6', sunExposure: 'full-sun', onboarded: true },
    beds: [{ id: 'bed-1', name: 'Bed 1', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0 }],
    plants: plants.map((p, i) => {
      const id = p.id ?? `p${i + 1}`;
      return { bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: id, ...p, id };
    }),
    dismissedConflictKeys: [],
  };
}

interface Garden {
  /** Saves `plan` before the app loads (only on the first navigation, so reloads keep what the app saved). */
  seed(plan: GardenPlan): Promise<void>;
  /** The active garden as the app has saved it. */
  plan(): Promise<GardenPlan>;
  /** Screen position of a point in a bed's own frame, in inches. Unrotated beds only. */
  bedPoint(bedId: string, x: number, y: number): Promise<{ x: number; y: number }>;
  /** Screen position of a plant's center. */
  plantPoint(plantId: string): Promise<{ x: number; y: number }>;
  drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
}

function garden(page: Page): Garden {
  const point = async (selector: string) => {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`${selector} is not on screen`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  return {
    async seed(plan) {
      await page.addInitScript(
        ({ plan, indexKey, key }) => {
          if (localStorage.getItem(indexKey)) return;
          localStorage.setItem(indexKey, JSON.stringify({ version: 1, gardenIds: [plan.id], activeGardenId: plan.id }));
          localStorage.setItem(key, JSON.stringify(plan));
        },
        { plan, indexKey: INDEX_KEY, key: planKey(plan.id) },
      );
    },
    async plan() {
      const raw = await page.evaluate(
        ({ indexKey, prefix }) => {
          const index = JSON.parse(localStorage.getItem(indexKey) ?? 'null');
          return index?.activeGardenId ? localStorage.getItem(prefix + index.activeGardenId) : null;
        },
        { indexKey: INDEX_KEY, prefix: 'garden-planner-plan:' },
      );
      if (!raw) throw new Error('no saved garden');
      return JSON.parse(raw) as GardenPlan;
    },
    async bedPoint(bedId, x, y) {
      const m = await page.locator(`[data-bed-id="${bedId}"]`).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { left: r.left + parseFloat(s.borderLeftWidth), top: r.top + parseFloat(s.borderTopWidth), pxW: el.clientWidth };
      });
      const bed = (await this.plan()).beds.find((b) => b.id === bedId);
      if (!bed) throw new Error(`no bed ${bedId}`);
      const scale = m.pxW / bed.widthIn;
      return { x: m.left + x * scale, y: m.top + y * scale };
    },
    plantPoint: (id) => point(`[data-plant-id="${id}"]`),
    async drag(from, to) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
    },
  };
}

/**
 * `page` here is hermetic and strict: requests to anything but the dev server (map tiles,
 * geocoding) are aborted, and an uncaught page error or console error fails the test.
 */
declare global {
  interface Window {
    __mockGardenApi?: MockGardenApi;
  }
}

/** Scripting for the app's mock `GardenApi` (see mockApiFlagKey in the app): call `enable()` before `goto`. */
interface Mock {
  enable(): Promise<void>;
  /** Every `apply` the client has made so far. */
  calls(): Promise<RecordedCall[]>;
  /** The commands of every call, flattened. */
  commands(): Promise<Command[]>;
  failNext(errors: Omit<ApiError, 'commandIndex'>[]): Promise<void>;
  setWarnings(warnings: Warning[] | null): Promise<void>;
  /** Change the garden behind the client's back. */
  replacePlan(plan: GardenPlan): Promise<void>;
  /** The garden as the mock holds it (the mock doesn't save to localStorage). */
  plan(): Promise<GardenPlan>;
}

function mock(page: Page): Mock {
  const api = <T,>(fn: (m: NonNullable<Window['__mockGardenApi']>) => T) =>
    page.evaluate(`(${fn.toString()})(window.__mockGardenApi)`) as Promise<T>;
  const call = <A,>(name: string, arg: A) => page.evaluate(([n, a]) => (window.__mockGardenApi as any)[n](a), [name, arg] as const) as Promise<void>;
  return {
    enable: () => page.addInitScript(() => localStorage.setItem('garden-planner-mock-api', '1')),
    calls: () => api((m) => JSON.parse(JSON.stringify(m.calls))),
    commands: async () => (await api((m) => JSON.parse(JSON.stringify(m.calls)) as RecordedCall[])).flatMap((c) => c.commands),
    failNext: (errors) => call('failNext', errors),
    setWarnings: (warnings) => call('setWarnings', warnings),
    replacePlan: (plan) => call('replacePlan', plan),
    plan: () => api((m) => JSON.parse(JSON.stringify(m.getSnapshot().plan))),
  };
}

export const test = base.extend<{ garden: Garden; mock: Mock }>({
  page: async ({ page }, provide) => {
    const problems: string[] = [];
    await page.route(/^(?!http:\/\/localhost)/, (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      // Aborted external requests (tiles, fonts) surface as network errors; those are expected here.
      if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await provide(page);
    expect(problems).toEqual([]);
  },
  garden: async ({ page }, provide) => provide(garden(page)),
  mock: async ({ page }, provide) => provide(mock(page)),
});

export { expect };
