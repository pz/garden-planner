import type { CropDef, GardenPlan } from '../types';
import { setCustomCrops } from '../data/crops';
import { parseGardenFile } from '../core/gardenFile';
import { parseSpec, type PlantingSpec } from './spec';
import { parseScenario, type Scenario, type ScenarioRunOptions, type Expectation } from './scenario';

import emptyGarden from './fixtures/gardens/empty-4x8.garden.json';
import twoRaisedBeds from './fixtures/gardens/two-raised-beds.garden.json';
import oddShapes from './fixtures/gardens/odd-shapes.garden.json';
import northRow from './fixtures/gardens/north-row.garden.json';
import northRowEast from './fixtures/gardens/north-row-east.garden.json';
import tinyBed from './fixtures/gardens/tiny-bed.garden.json';
import crowded from './fixtures/gardens/crowded.garden.json';
import shortSeason from './fixtures/gardens/short-season.garden.json';
import customCrop from './fixtures/gardens/custom-crop.garden.json';

import fillBasic from './fixtures/specs/fill-basic.spec.json';
import fillSaladGarden from './fixtures/specs/fill-salad-garden.spec.json';
import fillBedRestricted from './fixtures/specs/fill-bed-restricted.spec.json';
import fillMinMax from './fixtures/specs/fill-min-max.spec.json';
import fillCustomCrop from './fixtures/specs/fill-custom-crop.spec.json';
import fillShortSeason from './fixtures/specs/fill-short-season.spec.json';
import fillShadeOrder from './fixtures/specs/fill-shade-order.spec.json';
import fillTiny from './fixtures/specs/fill-tiny.spec.json';
import fillOddShapes from './fixtures/specs/fill-odd-shapes.spec.json';
import adjustMoreTomatoes from './fixtures/specs/adjust-more-tomatoes.spec.json';
import adjustLocked from './fixtures/specs/adjust-locked.spec.json';
import adjustSwapBeans from './fixtures/specs/adjust-swap-beans.spec.json';
import replaceBed2 from './fixtures/specs/replace-bed-2.spec.json';

import sFillEmpty from './fixtures/scenarios/fill-empty-4x8.scenario.json';
import sFillSalad from './fixtures/scenarios/fill-salad-garden.scenario.json';
import sFillAround from './fixtures/scenarios/fill-around-existing.scenario.json';
import sFillBedRestricted from './fixtures/scenarios/fill-bed-restricted.scenario.json';
import sFillMinMax from './fixtures/scenarios/fill-min-max.scenario.json';
import sFillCustom from './fixtures/scenarios/fill-custom-crop.scenario.json';
import sFillShort from './fixtures/scenarios/fill-short-season.scenario.json';
import sFillTiny from './fixtures/scenarios/fill-tiny-bed.scenario.json';
import sFillOdd from './fixtures/scenarios/fill-odd-shapes.scenario.json';
import sFillNorth from './fixtures/scenarios/fill-north-row.scenario.json';
import sFillNorthEast from './fixtures/scenarios/fill-north-row-east.scenario.json';
import sAdjustMore from './fixtures/scenarios/adjust-more-tomatoes.scenario.json';
import sAdjustLocked from './fixtures/scenarios/adjust-locked.scenario.json';
import sAdjustSwap from './fixtures/scenarios/adjust-swap-beans.scenario.json';
import sReplace from './fixtures/scenarios/replace-bed-2.scenario.json';

// The fixture registry. JSON is imported by name (not globbed) so it works the same in Node, tsx,
// vitest and the app, and typechecks without ambient Vite types. `catalog.test.ts` fails if a
// file in fixtures/ is missing from here.

/** Fixture files by name (the file name without `.garden.json` / `.spec.json` / `.scenario.json`). */
export const GARDEN_FILES: Record<string, unknown> = {
  'empty-4x8': emptyGarden,
  'two-raised-beds': twoRaisedBeds,
  'odd-shapes': oddShapes,
  'north-row': northRow,
  'north-row-east': northRowEast,
  'tiny-bed': tinyBed,
  crowded,
  'short-season': shortSeason,
  'custom-crop': customCrop,
};

export const SPEC_FILES: Record<string, unknown> = {
  'fill-basic': fillBasic,
  'fill-salad-garden': fillSaladGarden,
  'fill-bed-restricted': fillBedRestricted,
  'fill-min-max': fillMinMax,
  'fill-custom-crop': fillCustomCrop,
  'fill-short-season': fillShortSeason,
  'fill-shade-order': fillShadeOrder,
  'fill-tiny': fillTiny,
  'fill-odd-shapes': fillOddShapes,
  'adjust-more-tomatoes': adjustMoreTomatoes,
  'adjust-locked': adjustLocked,
  'adjust-swap-beans': adjustSwapBeans,
  'replace-bed-2': replaceBed2,
};

export const SCENARIO_FILES: Record<string, unknown> = {
  'fill-empty-4x8': sFillEmpty,
  'fill-salad-garden': sFillSalad,
  'fill-around-existing': sFillAround,
  'fill-bed-restricted': sFillBedRestricted,
  'fill-min-max': sFillMinMax,
  'fill-custom-crop': sFillCustom,
  'fill-short-season': sFillShort,
  'fill-tiny-bed': sFillTiny,
  'fill-odd-shapes': sFillOdd,
  'fill-north-row': sFillNorth,
  'fill-north-row-east': sFillNorthEast,
  'adjust-more-tomatoes': sAdjustMore,
  'adjust-locked': sAdjustLocked,
  'adjust-swap-beans': sAdjustSwap,
  'replace-bed-2': sReplace,
};

export const gardenNames = (): string[] => Object.keys(GARDEN_FILES);
export const scenarioNames = (): string[] => Object.keys(SCENARIO_FILES);

export interface LoadedGarden {
  plan: GardenPlan;
  customCrops: CropDef[];
}

/**
 * Loads a garden fixture with `parseGardenFile`, and registers the user-made crops it carries
 * (replacing any registered before; the registry is process-wide state in `data/crops`).
 * Throws with the reason if the fixture is bad: fixtures are ours, so that is a bug, not input.
 */
export function loadGarden(name: string): LoadedGarden {
  if (!Object.hasOwn(GARDEN_FILES, name)) throw new Error(`No garden fixture named "${name}" (have: ${gardenNames().join(', ')})`);
  const parsed = parseGardenFile(JSON.stringify(GARDEN_FILES[name]));
  if (!parsed.ok) throw new Error(`Garden fixture "${name}": ${parsed.error}`);
  setCustomCrops(parsed.customCrops);
  return { plan: parsed.plan, customCrops: parsed.customCrops };
}

/** A scenario with its garden and spec resolved and validated. */
export interface LoadedScenario {
  name: string;
  description?: string;
  plan: GardenPlan;
  spec: PlantingSpec;
  options: ScenarioRunOptions;
  expect: Expectation[];
}

/** Loads a scenario, its garden and its spec, throwing with every problem if any of them is invalid. */
export function loadScenario(name: string): LoadedScenario {
  if (!Object.hasOwn(SCENARIO_FILES, name)) throw new Error(`No scenario named "${name}" (have: ${scenarioNames().join(', ')})`);
  const parsed = parseScenario(SCENARIO_FILES[name]);
  if (!parsed.ok) throw new Error(`Scenario "${name}":\n${parsed.errors.map((e) => `  ${e.message}`).join('\n')}`);
  const scenario: Scenario = parsed.scenario;
  const { plan } = loadGarden(scenario.garden);
  if (!Object.hasOwn(SPEC_FILES, scenario.spec)) throw new Error(`Scenario "${name}": no spec fixture named "${scenario.spec}"`);
  const spec = parseSpec(SPEC_FILES[scenario.spec], plan);
  if (!spec.ok) throw new Error(`Scenario "${name}", spec "${scenario.spec}":\n${spec.errors.map((e) => `  ${e.message}`).join('\n')}`);
  return { name, description: scenario.description, plan, spec: spec.spec, options: scenario.options ?? {}, expect: scenario.expect };
}
