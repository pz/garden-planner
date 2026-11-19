import type { Bed, PlantInstance } from '../../types';
import { getCrop } from '../../data/crops';
import { drawnCornerRadius } from '../../core/layout';
import { PlantSprite, SpriteArt } from '../components/PlantSprite';

/**
 * One bed in its own (unrotated) frame, read-only: the outline, every plant's sprite at its
 * growing room, and the plants in `outlined` (the ones a proposal adds) on a light disc with a
 * thin, slowly turning dashed ring. Hovering a plant names it.
 */
export function BedView({ bed, plants, outlined }: { bed: Bed; plants: PlantInstance[]; outlined?: Set<string> }) {
  const pad = 6;
  const { widthIn: w, heightIn: h } = bed;
  const outline =
    bed.shape === 'ellipse' ? (
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />
    ) : bed.shape === 'polygon' && bed.points ? (
      <polygon points={bed.points.map((p) => `${p.x},${p.y}`).join(' ')} />
    ) : (
      <rect width={w} height={h} rx={drawnCornerRadius(bed)} />
    );
  return (
    <figure data-bed-view={bed.id} style={{ margin: 0 }}>
      <figcaption style={{ font: '600 13px Figtree', marginBottom: 4 }}>
        {bed.name} <span style={{ font: '400 12px Figtree', color: 'var(--color-neutral-700)' }}>{w}×{h} in · {plants.length} plants</span>
      </figcaption>
      <svg viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`} style={{ width: '100%', maxWidth: 460, display: 'block', overflow: 'visible' }} role="img" aria-label={`${bed.name}, ${plants.length} plants`}>
        <g fill="var(--color-surface)" stroke="var(--color-neutral-500)" strokeWidth={1}>
          {outline}
        </g>
        {plants.map((p, i) => {
          const r = getCrop(p.cropId).spacingIn / 2;
          const isNew = outlined?.has(p.id);
          return (
            <g key={p.id} data-plant-id={p.id} data-crop-id={p.cropId} data-new-plant={isNew ? '' : undefined} transform={`translate(${p.x} ${p.y})`} style={{ pointerEvents: 'all' }}>
              <title>{`${getCrop(p.cropId).name} · ${getCrop(p.cropId).spacingIn} in apart${isNew ? ' · proposed' : ''}`}</title>
              {isNew && <circle r={r * 0.98} fill="#fffdf8" opacity={0.65} />}
              <SpriteArt cropId={p.cropId} radius={r} rotation={(i * 47) % 360} />
              {isNew && <circle className="solver-new-ring" r={r} fill="none" stroke="var(--color-accent)" strokeWidth={0.45} strokeDasharray="2.5 2.5" strokeLinecap="round" />}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Which icon is which crop: one row per crop in `plants`, with its count. */
export function Legend({ plants }: { plants: PlantInstance[] }) {
  const counts = new Map<string, number>();
  for (const p of plants) counts.set(p.cropId, (counts.get(p.cropId) ?? 0) + 1);
  if (counts.size === 0) return null;
  return (
    <ul aria-label="Legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', listStyle: 'none', margin: '10px 0 0', padding: 0, font: '400 12px Figtree' }}>
      {[...counts].sort((a, b) => getCrop(a[0]).name.localeCompare(getCrop(b[0]).name)).map(([cropId, n]) => (
        <li key={cropId} data-legend={cropId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <PlantSprite cropId={cropId} diameter={24} />
          {getCrop(cropId).name} <span style={{ color: 'var(--color-neutral-700)' }}>{n}</span>
        </li>
      ))}
    </ul>
  );
}
