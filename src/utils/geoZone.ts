import { ZONES } from '../data/zones';

/**
 * Rough USDA-zone estimate from latitude alone, entirely client-side (no geocoding
 * service). Latitude is the single biggest driver of average winter minimums in the
 * continental US, but this ignores elevation, coastal effects, and microclimates —
 * it's a reasonable starting point, not a substitute for a real zone lookup. It's now only
 * the fallback for pins outside the bundled USDA zone map (see `zoneMap.ts`).
 */
const LATITUDE_BANDS: { maxAbsLat: number; zoneId: string }[] = [
  { maxAbsLat: 23, zoneId: '10' },
  { maxAbsLat: 27, zoneId: '9' },
  { maxAbsLat: 31, zoneId: '8' },
  { maxAbsLat: 35, zoneId: '7' },
  { maxAbsLat: 39, zoneId: '6' },
  { maxAbsLat: 43, zoneId: '5' },
  { maxAbsLat: 47, zoneId: '4' },
  { maxAbsLat: Infinity, zoneId: '3' },
];

export function zoneIdFromLatitude(latitude: number): string {
  const absLat = Math.abs(latitude);
  const band = LATITUDE_BANDS.find((b) => absLat <= b.maxAbsLat);
  return band?.zoneId ?? ZONES[3].id;
}

/** Asks the browser for the user's position. Rejects with `Error('unsupported')` or the browser's GeolocationPositionError. */
export function getBrowserPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60 * 60 * 1000 },
    );
  });
}
