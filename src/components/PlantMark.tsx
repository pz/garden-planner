import type { CropFamily } from '../types';

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

function FamilyGlyph({ family, size }: { family: CropFamily; size: number }) {
  const s = size;
  switch (family) {
    case 'fruiting':
      return <div style={{ width: s, height: s, borderRadius: '999px', background: '#fffdf8' }} />;
    case 'brassica':
      return <div style={{ width: s, height: s, borderRadius: s * 0.28, background: '#fffdf8' }} />;
    case 'root':
      return (
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: `${s * 0.55}px solid transparent`,
            borderRight: `${s * 0.55}px solid transparent`,
            borderTop: `${s}px solid #fffdf8`,
          }}
        />
      );
    case 'allium':
      return <div style={{ width: s * 0.3, height: s, borderRadius: '999px', background: '#fffdf8' }} />;
    case 'legume':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: s * 0.22 }}>
          <div style={{ width: s * 0.42, height: s * 0.42, borderRadius: '999px', background: '#fffdf8' }} />
          <div style={{ width: s * 0.42, height: s * 0.42, borderRadius: '999px', background: '#fffdf8' }} />
        </div>
      );
    case 'leafy':
      return <div style={{ width: s, height: s * 0.5, borderRadius: '999px 999px 0 0', background: '#fffdf8' }} />;
    case 'cucurbit':
      return <div style={{ width: s * 0.72, height: s * 0.72, background: '#fffdf8', transform: 'rotate(45deg)' }} />;
    case 'herb':
      return (
        <div
          style={{
            width: s,
            height: s,
            borderRadius: '999px',
            border: `${Math.max(2, s * 0.22)}px solid #fffdf8`,
          }}
        />
      );
    default:
      return null;
  }
}

export function PlantMark({
  family,
  color,
  diameter,
  glyphScale = 0.36,
}: {
  family: CropFamily;
  color: string;
  diameter: number;
  glyphScale?: number;
}) {
  return (
    <div
      style={{
        width: diameter,
        height: diameter,
        borderRadius: '999px',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <FamilyGlyph family={family} size={diameter * glyphScale} />
    </div>
  );
}
