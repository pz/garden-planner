import { memo, type ReactNode } from 'react';
import type { Bed, CropLook, GardenLine, Point } from '../../types';
import { findCrop } from '../../data/crops';
import { bedOutline, drawnCornerRadius } from '../../core/layout';
import type { Disc } from '../../core/planting';
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
  bedId: string;
  /** Being dragged somewhere that isn't a bed. */
  bad: boolean;
}

export interface Ghost {
  cropId: string;
  x: number;
  y: number;
  ok: boolean;
}

/** A suggestion drawn on the garden before it is applied: plants it adds, and plants it would take out. */
export interface SuggestedChange {
  /** In garden coordinates. */
  adds: { cropId: string; x: number; y: number }[];
  removed: ReadonlySet<string>;
}

/** One warning: the two patches it is about (by groupId), and what kind it is. */
export interface WarningLink {
  a: string;
  b: string;
  kind: 'spacing' | 'shade' | 'companion';
}

const LINK_LABEL: Record<WarningLink['kind'], string> = { spacing: 'Too close', shade: 'Shade', companion: 'Keep apart' };

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
  /** The warnings to draw (not the dismissed ones). */
  warnings: readonly WarningLink[];
  ghosts: Ghost[];
  marquee: { a: Point; b: Point } | null;
  /** The brush's ring under the pointer. */
  brush: { at: Point; r: number } | null;
  tag: Tag | null;
  /** The bed the card is scoped to: the others are dimmed. */
  selectedBedId?: string | null;
  suggestion?: SuggestedChange | null;
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
  /** Beds other than the one the card is scoped to fade back. */
  const dimmed = (bedId: string) => !!p.selectedBedId && p.selectedBedId !== bedId;
  const wholeSelected = (members: DrawnPlant[]) => members.every((m) => p.selected.has(m.id));
  const hoverGroup = p.hoverId ? p.plants.find((q) => q.id === p.hoverId)?.groupId : undefined;

  // Each warning ties two patches together: find the two plants that are closest, so the badge can sit on a plant
  // (not floating at a corner of the patch) and a line can show which neighbor it is about.
  interface Link extends WarningLink {
    pa: DrawnPlant;
    pb: DrawnPlant;
  }
  const links: Link[] = [];
  for (const w of p.warnings) {
    const A = groups.get(w.a);
    const B = groups.get(w.b);
    if (!A || !B) continue;
    let best: { pa: DrawnPlant; pb: DrawnPlant; d: number } | null = null;
    for (const pa of A) for (const pb of B) {
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (!best || d < best.d) best = { pa, pb, d };
    }
    links.push({ ...w, pa: best!.pa, pb: best!.pb });
  }
  const anchors = new Map<string, DrawnPlant>();
  for (const l of links) {
    if (!anchors.has(l.a)) anchors.set(l.a, l.pa);
    if (!anchors.has(l.b)) anchors.set(l.b, l.pb);
  }
  /** Selected or hovered: its warnings are drawn in full, with a line to the other plant. */
  const touched = (groupId: string) => groupId === hoverGroup || (groups.get(groupId) ?? []).some((m) => p.selected.has(m.id));
  const activeLinks = links.filter((l) => touched(l.a) || touched(l.b));
  const partners = new Set(activeLinks.flatMap((l) => [l.a, l.b]).filter((g) => !touched(g)));

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
    const anchor = anchors.get(groupId);
    if (anchor) {
      // A warned patch is ringed in the warning color, plant by plant, and the badge sits on the plant the warning is about.
      const strong = partners.has(groupId);
      badges.push(
        <g key={`wr${groupId}`} style={{ pointerEvents: 'none' }}>
          {members.map((m) => (
            <circle key={m.id} cx={m.x} cy={m.y} r={m.r + px(2)} fill="none" stroke="var(--color-warning)" strokeWidth={px(strong ? 3 : 1.8)} opacity={strong ? 1 : 0.85} />
          ))}
        </g>,
        <g key={`w${groupId}`} data-warning-badge={groupId} transform={`translate(${anchor.x + anchor.r * 0.72} ${anchor.y - anchor.r * 0.72})`} style={{ pointerEvents: 'none' }}>
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
        const chosen = p.selectedBedId === bed.id;
        return (
          <g key={bed.id} style={{ opacity: dimmed(bed.id) ? 0.55 : 1 }}>
            <g transform={bedTransform(bed)}>
              <BedShape bed={bed} fill="var(--color-neutral-200)" stroke={chosen ? 'var(--color-accent)' : 'var(--color-neutral-500)'} strokeWidth={px(chosen ? 3 : 1.5)} />
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

      {p.plants.map((pl) => {
        const gone = p.suggestion?.removed.has(pl.id);
        return (
          <g key={pl.id} transform={`translate(${pl.x} ${pl.y})`} data-suggested-removal={gone ? '' : undefined} style={{ opacity: gone ? 0.3 : pl.bad ? 0.45 : dimmed(pl.bedId) ? 0.55 : 1 }}>
            <PlantArt cropId={pl.cropId} r={radiusOf(pl.cropId)} rot={spriteRotation(pl.id)} look={findCrop(pl.cropId)?.look} />
            {gone && <circle r={pl.r} fill="none" stroke="var(--color-neutral-700)" strokeWidth={px(1.5)} strokeDasharray={`${px(4)} ${px(3)}`} />}
            <circle data-plant-id={pl.id} r={Math.max(pl.r * 0.2, px(2))} fill="none" />
          </g>
        );
      })}

      {p.suggestion?.adds.map((a, i) => {
        const r = radiusOf(a.cropId);
        return (
          <g key={`add${i}`} data-suggested-add={a.cropId} transform={`translate(${a.x} ${a.y})`} style={{ pointerEvents: 'none' }}>
            <circle r={r} fill="var(--color-surface-raised)" opacity={0.7} />
            <PlantArt cropId={a.cropId} r={r} rot={spriteRotation(`suggested-${i}`)} look={findCrop(a.cropId)?.look} />
            <circle r={r + px(1.5)} fill="none" stroke="var(--color-accent)" strokeWidth={px(2)} strokeDasharray={`${px(5)} ${px(4)}`} strokeLinecap="round" />
          </g>
        );
      })}

      {rings}
      {badges}

      {activeLinks.map((l, i) => {
        const mid = { x: (l.pa.x + l.pb.x) / 2, y: (l.pa.y + l.pb.y) / 2 };
        const text = LINK_LABEL[l.kind];
        const w = text.length * px(6.6) + px(16);
        return (
          <g key={`link${i}`} data-warning-link={l.kind} style={{ pointerEvents: 'none' }}>
            <line x1={l.pa.x} y1={l.pa.y} x2={l.pb.x} y2={l.pb.y} stroke="var(--color-warning)" strokeWidth={px(2.5)} strokeDasharray={`${px(6)} ${px(4)}`} strokeLinecap="round" />
            <circle cx={l.pa.x} cy={l.pa.y} r={px(3.5)} fill="var(--color-warning)" />
            <circle cx={l.pb.x} cy={l.pb.y} r={px(3.5)} fill="var(--color-warning)" />
            <g transform={`translate(${mid.x} ${mid.y})`}>
              <rect x={-w / 2} y={-px(10)} width={w} height={px(20)} rx={px(10)} fill="var(--color-warning)" stroke="#fffdf8" strokeWidth={px(1.5)} />
              <text y={px(4)} textAnchor="middle" style={{ font: `600 ${px(11)}px Figtree`, fill: '#fffdf8' }}>
                {text}
              </text>
            </g>
          </g>
        );
      })}

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
