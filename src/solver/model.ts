import type { Bed, CropDef, GardenPlan, Point } from '../types';
import type { Outline } from '../core/geometry';
import type { Block, Box } from './block';
import type { SolvePrefs, PlantingSpec, SolveMode } from './spec';
import type { UnmetReason } from './scenario';

/** What the solver knows about a bed. */
export interface BedInfo {
  bed: Bed;
  outline: Outline;
  /** In the spec's scope: the solver may plant here. */
  inScope: boolean;
}

/**
 * A patch as the solver sees it: the plants of one groupId in one bed. Fixed groups are the
 * existing plants the solver may not touch; the rest are the blocks it is placing.
 */
export interface Group {
  id: string;
  bedId: string;
  cropId: string;
  spacingIn: number;
  /** Plant centers in the bed's own frame. */
  points: Point[];
  /** The same plants in garden coordinates (for the shade rule, which works across beds). */
  garden: Point[];
  /** Box around `points`, bed frame. */
  box: Box;
  /** Box around `garden`. */
  gardenBox: Box;
  fixed: boolean;
}

/** One crop the solver is trying to place, after the pre-solve filters. */
export interface DemandInfo {
  cropId: string;
  crop: CropDef;
  weight: number;
  min?: number;
  max?: number;
  /** The beds it may be planted in (in scope, and the demand's own `bedIds` if given). */
  bedIds: string[];
  /** Plants to aim for, from the allocation. At least 1. */
  target: number;
}

/** Everything the algorithm reads, resolved from the plan and the spec once. */
export interface Ctx {
  plan: GardenPlan;
  spec: PlantingSpec;
  mode: SolveMode;
  prefs: Required<SolvePrefs>;
  fillRatio: number;
  beds: Map<string, BedInfo>;
  /** The crops to place, hardest first. */
  demands: DemandInfo[];
  /** Crops that were asked for but cannot be placed at all, with why. */
  filtered: Map<string, UnmetReason[]>;
  /** Existing plants the solver may not touch. */
  fixed: Group[];
  /** Existing patches the solver may move, resize or remove, as blocks (adjust mode). */
  editable: Block[];
  /** Existing patches to remove outright (excluded crops, a replaced scope). */
  removed: string[];
  /** The unit vector shadows fall along, in garden coordinates. */
  shadowDir: Point;
  /** Widest spacing of any crop in play, in inches: the neighbour query radius. */
  maxSpacingIn: number;
}
