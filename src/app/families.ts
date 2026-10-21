import type { CropFamily } from '../types';

/** The order the plant list groups crops in, with each group's heading. */
export const FAMILIES: { family: CropFamily; label: string }[] = [
  { family: 'nightshade', label: 'Nightshades' },
  { family: 'cucurbit', label: 'Squash & melons' },
  { family: 'brassica', label: 'Brassicas' },
  { family: 'root', label: 'Roots' },
  { family: 'leafy', label: 'Greens' },
  { family: 'herb', label: 'Herbs' },
  { family: 'allium', label: 'Alliums' },
  { family: 'legume', label: 'Legumes' },
  { family: 'flower', label: 'Flowers' },
  { family: 'grain', label: 'Grains' },
  { family: 'perennial', label: 'Perennials' },
];

export const familyLabel = (family: CropFamily) => FAMILIES.find((f) => f.family === family)?.label ?? family;
