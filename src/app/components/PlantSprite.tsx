import { SPR, drawCrop } from '../sprites';

/** Sprites are keyed by the sprite library's names; a crop id maps through here when they differ. */
const SPRITE_KEY: Record<string, string> = { beans: 'bean' };

/** Whether this crop has a sprite (otherwise it's drawn as a flat disc). */
export const hasSprite = (cropId: string) => (SPRITE_KEY[cropId] ?? cropId) in SPR;

/** The sprite as SVG shapes in the parent's units, centered on the origin and `radius` wide. */
export function SpriteArt({ cropId, radius, rotation = 0 }: { cropId: string; radius: number; rotation?: number }) {
  return (
    <g>
      <circle r={radius * 0.92} fill="var(--color-accent-2-900)" opacity={0.1} />
      <g transform={`scale(${radius})`}>{drawCrop(SPRITE_KEY[cropId] ?? cropId, rotation)}</g>
    </g>
  );
}

export function PlantSprite({
  cropId,
  diameter,
  rotation = 0,
  fallbackColor = 'var(--color-accent)',
}: {
  cropId: string;
  diameter: number;
  /** Degrees; turns the whole rosette so repeated plants don't look stamped. */
  rotation?: number;
  /** The flat disc drawn for a crop that has no sprite yet. */
  fallbackColor?: string;
}) {
  return (
    <svg
      width={diameter}
      height={diameter}
      viewBox="-1.05 -1.05 2.1 2.1"
      style={{ display: 'block', flex: 'none', overflow: 'visible', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      {hasSprite(cropId) ? <SpriteArt cropId={cropId} radius={1} rotation={rotation} /> : <circle r={0.7} fill={fallbackColor} />}
    </svg>
  );
}
