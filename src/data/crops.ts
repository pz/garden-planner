import type { CropDef } from '../types';
import cropsData from './crops.json';

// The eight "standard" crops from the storyboard's family-mark key (turn 6a),
// each in a different crop family so the flat family mark alone identifies it.
// Field meanings are documented in ./README.md.
export const CROPS: CropDef[] = cropsData as CropDef[];

export function getCrop(id: string): CropDef {
  const crop = CROPS.find((c) => c.id === id);
  if (!crop) throw new Error(`Unknown crop: ${id}`);
  return crop;
}
