import tipsData from './tips.json';

/** Human-written growing tips, keyed by crop id. Field meanings are documented in ./README.md. */
export const TIPS: Record<string, string> = tipsData;

/** The growing tip for a crop, or undefined if it has none. */
export function getTip(cropId: string): string | undefined {
  return Object.hasOwn(TIPS, cropId) ? TIPS[cropId] : undefined;
}
