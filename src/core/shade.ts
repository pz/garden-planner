import { getCrop } from '../data/crops';
import type { Bed, PlantInstance, Point } from '../types';
import { bedToGarden } from './layout';

/**
 * How far a plant's shadow reaches, as a multiple of its height: the shadow length of a plant at
 * midday in midsummer, when the sun is about 60° up (1 / tan 60°). A rule of thumb, not an
 * astronomical calculation: the point is to catch the clear cases (a tall tomato just south of a
 * basil), not to model every hour of the day.
 */
export const SHADE_REACH_FACTOR = 0.6;

/** A plant only matters as a shader if it is at least this much taller than the plant it shades, in inches. */
export const SHADE_HEIGHT_MARGIN_IN = 12;

/** One patch casting a midday shadow over another that needs full sun. */
export interface ShadeConflict {
  /** groupId of the shading patch. */
  caster: string;
  /** groupId of the shaded patch. */
  shaded: string;
  casterCropId: string;
  shadedCropId: string;
  /** How far the shaded plant is along the shadow, in inches (closest pair of members). */
  alongIn: number;
}

/**
 * The unit vector shadows fall along, in garden coordinates (x right, y down). The sun is toward
 * the equator at midday, so in the northern hemisphere shadows fall toward north, in the
 * southern toward south. `northDeg` is which way north points on the plan, in degrees clockwise
 * from straight up (0: north is up, 90: north is to the right); a missing latitude counts as
 * northern.
 */
export function shadowDirection(northDeg: number, latitude: number | undefined): Point {
  const t = (northDeg * Math.PI) / 180;
  // Straight up is (0, -1) with y down; turning it clockwise by northDeg gives north.
  const north = { x: Math.sin(t), y: -Math.cos(t) };
  const southern = latitude !== undefined && latitude < 0;
  return southern ? { x: -north.x, y: -north.y } : north;
}

/** A plant's center in garden coordinates (inches), given the bed it grows in. */
function gardenPoint(plant: PlantInstance, bed: Bed): Point {
  return bedToGarden(bed, { x: plant.x, y: plant.y });
}

/**
 * Patches that shade a plant needing full sun. A plant shades another if it is at least
 * `SHADE_HEIGHT_MARGIN_IN` taller, and the other sits ahead of it along the shadow direction,
 * within `SHADE_REACH_FACTOR × height` of it and inside the band the plant's own canopy
 * (its spacing) is wide. Works across beds, in garden coordinates. Only `sunNeed: full` crops
 * can be shaded; members of one patch never shade each other. Each (caster, shaded) pair of
 * patches is reported once, with its closest pair of plants.
 */
export function findShadeConflicts(
  plants: PlantInstance[],
  beds: Bed[],
  northDeg: number,
  latitude: number | undefined,
): ShadeConflict[] {
  const dir = shadowDirection(northDeg, latitude);
  const bedById = new Map(beds.map((b) => [b.id, b]));
  const located = plants.flatMap((p) => {
    const bed = bedById.get(p.bedId);
    return bed ? [{ plant: p, at: gardenPoint(p, bed), crop: getCrop(p.cropId) }] : [];
  });

  const byPair = new Map<string, ShadeConflict>();
  for (const a of located) {
    for (const b of located) {
      if (a.plant.groupId === b.plant.groupId) continue;
      if (b.crop.sunNeed !== 'full') continue;
      if (a.crop.heightIn - b.crop.heightIn < SHADE_HEIGHT_MARGIN_IN) continue;
      const dx = b.at.x - a.at.x;
      const dy = b.at.y - a.at.y;
      const along = dx * dir.x + dy * dir.y;
      const across = Math.abs(dx * dir.y - dy * dir.x);
      if (along <= 0 || along > a.crop.heightIn * SHADE_REACH_FACTOR) continue;
      if (across > a.crop.spacingIn / 2) continue;
      const key = `${a.plant.groupId}>${b.plant.groupId}`;
      const existing = byPair.get(key);
      if (existing && existing.alongIn <= along) continue;
      byPair.set(key, {
        caster: a.plant.groupId,
        shaded: b.plant.groupId,
        casterCropId: a.plant.cropId,
        shadedCropId: b.plant.cropId,
        alongIn: along,
      });
    }
  }
  return [...byPair.values()];
}
