import { memo, type ReactNode } from 'react';
import type { Bed, CropLook, GardenLine, Point } from '../../types';
import { findCrop } from '../../data/crops';
import { bedOutline, drawnCornerRadius } from '../../core/layout';
import { extent, type Disc } from '../../core/planting';
import { radiusOf } from '../../core/placement';
import { CROP_COLORS } from '../components/PlantMark';
import { SpriteArt, hasSprite } from '../components/PlantSprite';
import { labelAnchor } from '../layoutInteraction';
import { spriteRotation } from '../spriteGeometry';
import type { View } from '../viewport';

const DANGER = 'oklch(0.55 0.19 28)';
/** Space between a plant's ring and the soft outline drawn around a patch. */
const PATCH_PAD_IN = 1.5;

export interface DrawnPlant extends Disc {
  cropId: string;
  /** Being dragged somewhere that isn't a bed. */
  bad: boolean;
}

export interface Ghost {
  cropId: string;
  x: number;
  y: number;
  ok: boolean;
}

export interface Tag {
  at: Point;
  text: string;
  warn: boolean;
}

export interface GardenSvgProps {
  camera: View;
  size: { w: number; h: number };
  beds: Bed[];
  /** Lines drawn on the layout; shown here, edited in the layout editor. */
  lines?: GardenLine[];
  plants: DrawnPlant[];
  selected: ReadonlySet<string>;
  hoverId: string | null;
  warnedGroups: ReadonlySet<string>;
  ghosts: Ghost[];
  marquee: { a: Point; b: Point } | null;
  /** The brush's ring under the pointer. */
  brush: { at: Point; r: number } | null;
  tag: Tag | null;
}

/** One plant's art at one size; it only redraws when the crop, its look, its size or its turn changes, not as the plant is dragged around. */
const PlantArt = memo(function PlantArt({ cropId, r, rot }: { cropId: string; r: number; rot: number; look?: CropLook }) {
  if (!hasSprite(cropId)) return <circle r={r * 0.7} fill={CROP_COLORS[cropId] ?? 'var(--color-accent)'} />;
  return <SpriteArt cropId={cropId} radius={r} rotation={rot} />;
});

function BedShape({ bed, fill, stroke, strokeWidth }: { bed: Bed; fill: string; stroke?: string; strokeWidth?: number }) {
  const o = bedOutline(bed);
  const common = { fill, stroke, strokeWidth, strokeLinejoin: 'round' as const };
  if (o.shape === 'ellipse') return <ellipse cx={o.widthIn / 2} cy={o.heightIn / 2} rx={o.widthIn / 2} ry={o.heightIn / 2} {...common} />;
  if (o.shape === 'polygon') return <polygon points={o.points.map((q) => `${q.x},${q.y}`).join(' ')} {...common} />;
  const r = drawnCornerRadius(bed);
  return <rect width={o.widthIn} height={o.heightIn} rx={r} ry={r} {...common} />;
}

/** A bed's own frame: its center at the bed's place in the garden, turned with it, origin at its top-left. */
export const bedTransform = (bed: Bed) => `translate(${bed.cx} ${bed.cy}) rotate(${bed.rotationDeg}) translate(${-bed.widthIn / 2} ${-bed.heightIn / 2})`;

/** The garden as one SVG in garden inches: beds, patch outlines, plants and gesture previews. */
export function GardenSvg(p: GardenSvgProps) {
  const { camera: cam, size } = p;
  const z = cam.zoom;
  const px = (v: number) => v / z;
  const viewW = size.w / z;
  const viewH = size.h / z;

  const groups = new Map<string, DrawnPlant[]>();
  for (const pl of p.plants) groups.set(pl.groupId, [...(groups.get(pl.groupId) ?? []), pl]);
  const wholeSelected = (members: DrawnPlant[]) => members.every((m) => p.selected.has(m.id));
  const hoverGroup = p.hoverId ? p.plants.find((q) => q.id === p.hoverId)?.groupId : undefined;

  const patches: ReactNode[] = [];
  const badges: ReactNode[] = [];
  for (const [groupId, members] of groups) {
    if (members.length >= 2) {
      const on = wholeSelected(members);
      const hot = hoverGroup === groupId;
      const ow = px(on ? 2.5 : hot ? 1.5 : 1);
      const outline = on ? 'var(--color-accent)' : hot ? 'var(--color-neutral-500)' : 'var(--color-neutral-400)';
      const fill = on ? 'var(--color-accent-100)' : 'var(--color-neutral-100)';
      patches.push(
        <g key={groupId} style={{ pointerEvents: 'none', opacity: on ? 0.85 : hot ? 0.7 : 0.45 }}>
          {members.map((m) => <circle key={`o${m.id}`} cx={m.x} cy={m.y} r={m.r + PATCH_PAD_IN + ow} fill={outline} />)}
          {members.map((m) => <circle key={`f${m.id}`} cx={m.x} cy={m.y} r={m.r + PATCH_PAD_IN} fill={fill} />)}
        </g>,
      );
    }
    if (p.warnedGroups.has(groupId)) {
      const box = extent(members)!;
      badges.push(
        <g key={`w${groupId}`} transform={`translate(${box.x1} ${box.y0})`} style={{ pointerEvents: 'none' }}>
          <circle r={px(9)} fill="var(--color-warning)" stroke="#fffdf8" strokeWidth={px(1.5)} />
          <text y={px(4)} textAnchor="middle" style={{ font: `700 ${px(11)}px Figtree`, fill: '#fffdf8' }}>!</text>
        </g>,
      );
    }
  }

  const rings: ReactNode[] = [];
  for (const pl of p.plants) {
    const members = groups.get(pl.groupId)!;
    const solo = members.length < 2;
    if (p.selected.has(pl.id) && (solo || !wholeSelected(members))) {
      rings.push(<circle key={`s${pl.id}`} cx={pl.x} cy={pl.y} r={pl.r + px(3)} fill="none" stroke="var(--color-accent)" strokeWidth={px(3)} />);
    } else if (p.hoverId === pl.id && solo && !p.selected.has(pl.id)) {
      rings.push(<circle key={`h${pl.id}`} cx={pl.x} cy={pl.y} r={pl.r + px(2)} fill="none" stroke="var(--color-neutral-600)" strokeWidth={px(2)} />);
    }
    if (pl.bad) rings.push(<circle key={`x${pl.id}`} cx={pl.x} cy={pl.y} r={pl.r + px(2)} fill="none" stroke={DANGER} strokeWidth={px(2)} />);
  }

  const tagFont = px(13);
  const tagW = p.tag ? p.tag.text.length * tagFont * 0.55 + px(20) : 0;
  const tagH = tagFont * 2;

  return (
    <svg
      viewBox={`${cam.x} ${cam.y} ${viewW} ${viewH}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
    >
      <defs>
        <pattern id="planting-dots" width={6} height={6} patternUnits="userSpaceOnUse">
          <circle cx={3} cy={3} r={px(1.1)} fill="var(--color-neutral-500)" />
        </pattern>
      </defs>

      {p.beds.map((bed) => {
        const label = labelAnchor(bed);
        return (
          <g key={bed.id}>
            <g transform={bedTransform(bed)}>
              <BedShape bed={bed} fill="var(--color-neutral-200)" stroke="var(--color-neutral-500)" strokeWidth={px(1.5)} />
              <BedShape bed={bed} fill="url(#planting-dots)" />
              {/* The bed's box exactly, as a stable target for tests and tools; draws nothing. */}
              <rect data-bed-id={bed.id} width={bed.widthIn} height={bed.heightIn} fill="none" />
            </g>
            <text
              x={label.x}
              y={label.y - px(9)}
              textAnchor={label.align === 'middle' ? 'middle' : 'start'}
              style={{ font: `600 ${px(13)}px Figtree`, fill: 'var(--color-neutral-700)' }}
            >
              {bed.name}
            </text>
          </g>
        );
      })}

      {p.lines?.map((l) => (
        <line key={l.id} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="var(--color-neutral-600)" strokeWidth={px(2.5)} strokeLinecap="round" />
      ))}

      {patches}

      {p.plants.map((pl) => (
        <g key={pl.id} transform={`translate(${pl.x} ${pl.y})`} style={{ opacity: pl.bad ? 0.45 : 1 }}>
          <PlantArt cropId={pl.cropId} r={radiusOf(pl.cropId)} rot={spriteRotation(pl.id)} look={findCrop(pl.cropId)?.look} />
          <circle data-plant-id={pl.id} r={Math.max(pl.r * 0.2, px(2))} fill="none" />
        </g>
      ))}

      {rings}
      {badges}

      {p.ghosts.map((g, i) => (
        <g key={i} transform={`translate(${g.x} ${g.y})`} style={{ opacity: g.ok ? 0.6 : 0.35 }}>
          {g.ok ? (
            <PlantArt cropId={g.cropId} r={radiusOf(g.cropId)} rot={41} look={findCrop(g.cropId)?.look} />
          ) : (
            <circle r={radiusOf(g.cropId)} fill="none" stroke={DANGER} strokeWidth={px(1.5)} strokeDasharray={`${px(3)} ${px(2)}`} />
          )}
        </g>
      ))}

      {p.marquee && (
        <rect
          x={Math.min(p.marquee.a.x, p.marquee.b.x)}
          y={Math.min(p.marquee.a.y, p.marquee.b.y)}
          width={Math.abs(p.marquee.b.x - p.marquee.a.x)}
          height={Math.abs(p.marquee.b.y - p.marquee.a.y)}
          fill="var(--color-accent-100)"
          fillOpacity={0.4}
          stroke="var(--color-accent)"
          strokeWidth={px(1.5)}
          strokeDasharray={`${px(5)} ${px(4)}`}
        />
      )}

      {p.brush && <circle cx={p.brush.at.x} cy={p.brush.at.y} r={Math.max(p.brush.r, px(8))} fill="none" stroke="var(--color-accent)" strokeWidth={px(2)} />}

      {p.tag && (
        <g transform={`translate(${p.tag.at.x + px(16)} ${p.tag.at.y + px(14)})`}>
          <rect width={tagW} height={tagH} rx={tagH / 2} fill={p.tag.warn ? DANGER : 'var(--color-neutral-900)'} />
          <text x={tagW / 2} y={tagH / 2} dy="0.35em" textAnchor="middle" style={{ font: `600 ${tagFont}px Figtree`, fill: 'var(--color-neutral-100)' }}>
            {p.tag.text}
          </text>
        </g>
      )}
    </svg>
  );
}
