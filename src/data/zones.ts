export interface ZoneInfo {
  id: string;
  label: string;
  /** Approximate average last spring frost date, month/day. */
  lastFrost: { month: number; day: number };
  /** Approximate average first fall frost date, month/day. */
  firstFrost: { month: number; day: number };
}

// Rough, widely-used averages per USDA zone. Good enough for planning guidance,
// not a substitute for a local extension office.
export const ZONES: ZoneInfo[] = [
  { id: '3', label: 'Zone 3', lastFrost: { month: 5, day: 30 }, firstFrost: { month: 9, day: 1 } },
  { id: '4', label: 'Zone 4', lastFrost: { month: 5, day: 15 }, firstFrost: { month: 9, day: 15 } },
  { id: '5', label: 'Zone 5', lastFrost: { month: 4, day: 30 }, firstFrost: { month: 10, day: 1 } },
  { id: '6', label: 'Zone 6', lastFrost: { month: 4, day: 15 }, firstFrost: { month: 10, day: 15 } },
  { id: '7', label: 'Zone 7', lastFrost: { month: 3, day: 30 }, firstFrost: { month: 10, day: 30 } },
  { id: '8', label: 'Zone 8', lastFrost: { month: 3, day: 15 }, firstFrost: { month: 11, day: 15 } },
  { id: '9', label: 'Zone 9', lastFrost: { month: 2, day: 15 }, firstFrost: { month: 12, day: 1 } },
  { id: '10', label: 'Zone 10', lastFrost: { month: 1, day: 30 }, firstFrost: { month: 12, day: 15 } },
];

export function getZone(id: string): ZoneInfo {
  return ZONES.find((z) => z.id === id) ?? ZONES[3];
}

export function zoneLastFrostDate(zone: ZoneInfo, year: number): Date {
  return new Date(year, zone.lastFrost.month - 1, zone.lastFrost.day);
}

export function zoneFirstFrostDate(zone: ZoneInfo, year: number): Date {
  return new Date(year, zone.firstFrost.month - 1, zone.firstFrost.day);
}
