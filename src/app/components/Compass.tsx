import { useRef } from 'react';
import { normalizeAngle } from '../../core/layout';
import { rotationFromPointer } from '../layoutInteraction';

const SIZE = 72;
const KEY_STEP_DEG = 15;

/**
 * Where geographic north lies on the layout, drawn as a compass needle. Given `onChange` it's a
 * control: drag the dial to point the needle (Alt turns the snapping off), use the arrow keys to
 * turn it, double-click to point it straight up. Without it, it's a read-only marker.
 */
export function Compass({ northDeg, onChange }: { northDeg: number; onChange?: (deg: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const deg = normalizeAngle(northDeg);

  function pointTo(e: React.PointerEvent) {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !onChange) return;
    onChange(rotationFromPointer({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 }, { x: e.clientX, y: e.clientY }, e.altKey));
  }

  const interactive = !!onChange;
  const needle = (
    <svg width={SIZE} height={SIZE} viewBox="-36 -36 72 72" aria-hidden="true" style={{ display: 'block' }}>
      <circle r={34} fill="var(--color-surface-raised)" stroke="var(--color-divider)" strokeWidth={1.5} />
      {[0, 90, 180, 270].map((a) => (
        <line key={a} x1={0} y1={-34} x2={0} y2={-30} stroke="var(--color-text-muted)" strokeWidth={1.5} transform={`rotate(${a})`} />
      ))}
      <g transform={`rotate(${deg})`}>
        <polygon points="0,-22 5,0 -5,0" fill="var(--color-accent)" />
        <polygon points="0,22 5,0 -5,0" fill="var(--color-text-muted)" opacity={0.5} />
        <g transform="translate(0 -27)">
          {/* Counter-turned so the letter stays upright wherever the needle points. */}
          <text
            transform={`rotate(${-deg})`}
            textAnchor="middle"
            dominantBaseline="central"
            style={{ font: '800 11px Figtree', fill: 'var(--color-accent-700)' }}
          >
            N
          </text>
        </g>
      </g>
    </svg>
  );

  if (!interactive) {
    return (
      <div data-testid="compass" style={{ pointerEvents: 'none', filter: 'drop-shadow(var(--shadow-sm))' }} title={`North is ${deg}° clockwise from up`}>
        {needle}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-testid="compass"
      role="slider"
      tabIndex={0}
      aria-label="North direction"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={deg}
      aria-valuetext={`${deg}° clockwise from up`}
      title="Set which way is north: drag, or use the arrow keys. Double-click to reset."
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointTo(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current) pointTo(e);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onDoubleClick={() => onChange(0)}
      onKeyDown={(e) => {
        const turn = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? KEY_STEP_DEG : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -KEY_STEP_DEG : null;
        if (turn !== null) onChange(deg + turn);
        else if (e.key === 'Home') onChange(0);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ touchAction: 'none', cursor: 'grab', borderRadius: '50%', filter: 'drop-shadow(var(--shadow-md))' }}
    >
      {needle}
    </div>
  );
}
