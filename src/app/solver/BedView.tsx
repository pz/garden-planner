import type { Bed, PlantInstance } from '../../types';
import { getCrop } from '../../data/crops';
import { drawnCornerRadius } from '../../core/layout';
import { SpriteArt } from '../components/PlantSprite';

/**
 * One bed in its own (unrotated) frame, read-only: the outline, every plant's sprite at its
 * growing room, and a dashed ring around the plants in `outlined` (the ones a proposal adds).
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
            <g key={p.id} data-plant-id={p.id} data-crop-id={p.cropId} data-new-plant={isNew ? '' : undefined} transform={`translate(${p.x} ${p.y})`}>
              <SpriteArt cropId={p.cropId} radius={r} rotation={(i * 47) % 360} />
              {isNew && <circle r={r} fill="none" stroke="var(--color-accent)" strokeWidth={0.9} strokeDasharray="3 2" />}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
