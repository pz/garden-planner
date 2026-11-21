import type { Command } from '../api/commands';
import type { Want } from '../core/adjust';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { bedArea } from './allocate';

/** What the "adjust the plan" card hands to whatever makes suggestions. */
export interface SuggestRequest {
  /** Only this bed is planned; absent means the whole garden. */
  bedId?: string;
  wants: readonly Want[];
  /** 0 the first time; "Try again" adds one, and expects a different arrangement of the same request. */
  attempt: number;
}

export interface DiffRow {
  cropId: string;
  before: number;
  after: number;
  /** Set when the request could not be met in full, in words ("only room for 9"). */
  note?: string;
}

/** A plant a suggestion adds, in its bed's own frame. */
export interface AddedPlant {
  cropId: string;
  bedId: string;
  x: number;
  y: number;
}

/** A proposed change to the garden, not yet applied. */
export interface Suggestion {
  /** Send these with `GardenApi.apply` to apply it. Empty when there is nothing to change. */
  commands: Command[];
  adds: AddedPlant[];
  /** Ids of the plants it would take out. */
  removed: string[];
  rows: DiffRow[];
  /** One line on what it did and why. */
  reasoning: string;
  /** The planted share of the scope's beds, before and after, from 0 to 1. */
  fullness: { before: number; after: number };
  attempt: number;
}

/** Whatever makes suggestions: the placeholder today, the planting solver next. */
export type Suggester = (plan: GardenPlan, request: SuggestRequest) => Suggestion;

/** The share of a set of beds taken up by plants' growing rooms (spacing squared each), from 0 to 1. */
export function bedFullness(beds: readonly Bed[], plants: readonly PlantInstance[]): number {
  const ids = new Set(beds.map((b) => b.id));
  const area = beds.reduce((s, b) => s + bedArea(b), 0);
  if (area === 0) return 0;
  const used = plants.filter((p) => ids.has(p.bedId)).reduce((s, p) => s + getCrop(p.cropId).spacingIn ** 2, 0);
  return Math.min(1, used / area);
}
