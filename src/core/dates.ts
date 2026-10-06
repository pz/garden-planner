import type { CropDef } from '../types';
import { type ZoneInfo, zoneLastFrostDate } from '../data/zones';

export interface PlantingSchedule {
  startIndoors?: Date;
  sowOrTransplant: Date;
  sowOrTransplantLabel: string;
  harvest: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/** Codified (non-AI) planting schedule for a crop in a given zone. */
export function scheduleFor(crop: CropDef, zone: ZoneInfo, year: number): PlantingSchedule {
  const lastFrost = zoneLastFrostDate(zone, year);

  if (crop.sowMethod === 'transplant') {
    const startIndoors = addWeeks(lastFrost, -(crop.startIndoorsWeeksBeforeLastFrost ?? 6));
    const transplant = addWeeks(lastFrost, crop.transplantWeeksAfterLastFrost ?? 0);
    return {
      startIndoors,
      sowOrTransplant: transplant,
      sowOrTransplantLabel: 'Transplant outside',
      harvest: addDays(transplant, crop.daysToMaturity),
    };
  }

  const directSow = addWeeks(lastFrost, crop.directSowWeeksRelativeToLastFrost ?? 0);
  return {
    sowOrTransplant: directSow,
    sowOrTransplantLabel: 'Sow outside',
    harvest: addDays(directSow, crop.daysToMaturity),
  };
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
