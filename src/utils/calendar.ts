import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { getZone } from '../data/zones';
import { scheduleFor, type PlantingSchedule } from './dates';

export interface CalendarEntry {
  groupId: string;
  cropId: string;
  cropName: string;
  /** Number of plants sharing this patch's groupId. */
  count: number;
  schedule: PlantingSchedule;
}

/** The first date a crop's schedule asks the gardener to do something. */
export function earliestScheduledDate(schedule: PlantingSchedule): Date {
  return schedule.startIndoors ?? schedule.sowOrTransplant;
}

/**
 * One entry per planted patch (plants sharing a groupId), sorted chronologically
 * by each entry's earliest scheduled date.
 */
export function buildCalendarEntries(plants: PlantInstance[], zoneId: string, year: number): CalendarEntry[] {
  const zone = getZone(zoneId);
  const groups = new Map<string, PlantInstance[]>();
  for (const p of plants) {
    const members = groups.get(p.groupId);
    if (members) members.push(p);
    else groups.set(p.groupId, [p]);
  }

  const entries = Array.from(groups.values()).map((members) => {
    const crop = getCrop(members[0].cropId);
    return {
      groupId: members[0].groupId,
      cropId: crop.id,
      cropName: crop.name,
      count: members.length,
      schedule: scheduleFor(crop, zone, year),
    };
  });

  entries.sort((a, b) => earliestScheduledDate(a.schedule).getTime() - earliestScheduledDate(b.schedule).getTime());
  return entries;
}
