import { PlantSprite } from './PlantSprite';

/** Flat family mark colors, matching the storyboard's turn-6a key. */
export const CROP_COLORS: Record<string, string> = {
  tomato: 'var(--color-accent)',
  kale: 'var(--color-accent-2-700)',
  carrot: '#8d7a4f',
  onion: '#9a7f9c',
  beans: 'var(--color-accent-2)',
  lettuce: '#6f8f6a',
  squash: '#c99a45',
  basil: '#7a8a5e',
};

/** A crop's sprite at icon size (menus, the calendar, the info card). */
export function PlantMark({ cropId, diameter, rotation }: { cropId: string; diameter: number; rotation?: number }) {
  return <PlantSprite cropId={cropId} diameter={diameter} rotation={rotation} fallbackColor={CROP_COLORS[cropId]} />;
}
