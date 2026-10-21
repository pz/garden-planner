import type { CropLook } from '../../types';
import { findCrop } from '../../data/crops';
import { SPR, drawCrop, drawSpec } from '../sprites';

/** Sprites are keyed by the sprite library's names; a crop id maps through here when they differ. */
const SPRITE_KEY: Record<string, string> = { beans: 'bean' };

/** Whether this crop has a sprite (otherwise it's drawn as a flat disc). */
export const hasSprite = (cropId: string) => !!findCrop(cropId)?.look || (SPRITE_KEY[cropId] ?? cropId) in SPR;

/** The sprite as SVG shapes in the parent's units, centered on the origin and `radius` wide. */
export function SpriteArt({ cropId, radius, rotation = 0 }: { cropId: string; radius: number; rotation?: number }) {
  const look = findCrop(cropId)?.look;
  return (
    <g>
      <circle r={radius * 0.92} fill="var(--color-accent-2-900)" opacity={0.1} />
      <g transform={`scale(${radius})`}>{look ? drawSpec(look, rotation) : drawCrop(SPRITE_KEY[cropId] ?? cropId, rotation)}</g>
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
    // The art spans radius 1 (its leaf tips touch the circle), so the viewBox puts that radius at the
    // edge of `diameter`; the 5% border is margin the art may spill into, not extra layout.
    <svg
      width={diameter * 1.05}
      height={diameter * 1.05}
      viewBox="-1.05 -1.05 2.1 2.1"
      style={{ display: 'block', flex: 'none', overflow: 'visible', pointerEvents: 'none', margin: -diameter * 0.025 }}
      aria-hidden="true"
    >
      {hasSprite(cropId) ? <SpriteArt cropId={cropId} radius={1} rotation={rotation} /> : <circle r={0.7} fill={fallbackColor} />}
    </svg>
  );
}

/** A plant drawn from a look alone (the add/edit dialog's preview, before the plant exists). */
export function LookSprite({ look, diameter, rotation = 20 }: { look: CropLook; diameter: number; rotation?: number }) {
  return (
    <svg width={diameter} height={diameter} viewBox="-1.05 -1.05 2.1 2.1" style={{ display: 'block', flex: 'none', overflow: 'visible' }} aria-hidden="true">
      <circle r={0.92} fill="var(--color-accent-2-900)" opacity={0.1} />
      {drawSpec(look, rotation)}
    </svg>
  );
}
