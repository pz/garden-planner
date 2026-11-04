import { useLayoutEffect, useRef, useState } from 'react';

/**
 * A bed's name on the layout canvas. Clicking it edits the name (text cursor); when the label is
 * hovered, its bed is selected, or it is being renamed or moved, it gets a dashed outline and a
 * grip on its right that drags it (the left is often under the tool rail). `x`/`y` are the text's anchor and baseline in garden inches;
 * `zoom` keeps the outline and grip a constant size on screen.
 */
export function BedLabel({
  bedId,
  name,
  x,
  y,
  align,
  zoom,
  interactive,
  active,
  strong,
  hidden,
  gripCursor,
  onEdit,
  onGripDown,
  onHover,
  fill,
  outline,
  accent,
}: {
  bedId: string;
  name: string;
  x: number;
  y: number;
  align: 'start' | 'middle';
  zoom: number;
  /** Whether the label can be edited and moved right now (the select tool, no dialog open). */
  interactive: boolean;
  /** Show the outline and grip. */
  active: boolean;
  /** Draw the outline in the accent colour (renaming or moving). */
  strong: boolean;
  /** The text is replaced by an input; keep the outline and grip, but don't draw the text. */
  hidden: boolean;
  gripCursor: string;
  onEdit: () => void;
  onGripDown: (e: React.PointerEvent) => void;
  onHover: (hovering: boolean) => void;
  fill: string;
  outline: string;
  accent: string;
}) {
  const px = (v: number) => v / zoom;
  const textRef = useRef<SVGTextElement>(null);
  /** The text's measured size, and how far its top sits above the baseline `y`. */
  const [box, setBox] = useState({ w: 0, h: 0, dy: 0 });
  useLayoutEffect(() => {
    const t = textRef.current;
    if (!t) return;
    const b = t.getBBox();
    setBox((prev) => (prev.w === b.width && prev.h === b.height && prev.dy === b.y - y ? prev : { w: b.width, h: b.height, dy: b.y - y }));
  }, [name, zoom, y]);

  const pad = px(4);
  const left = (align === 'middle' ? x - box.w / 2 : x) - pad;
  const top = y + box.dy - pad;
  const w = box.w + pad * 2;
  const h = box.h + pad * 2;
  const gripW = px(14);
  const show = interactive && active && box.w > 0;

  return (
    <g data-bed-label={bedId} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      {interactive && box.w > 0 && (
        // Covers the text and its outline so the label is one hover target; a press here edits the name.
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          rx={px(4)}
          data-bed-name={bedId}
          onPointerDown={(e) => {
            // Stop the press here so it doesn't pan the canvas or deselect the bed.
            if (e.button === 0) e.stopPropagation();
          }}
          onClick={(e) => e.button === 0 && onEdit()}
          style={{
            fill: 'transparent',
            stroke: show ? (strong ? accent : outline) : 'none',
            strokeWidth: px(1.5),
            strokeDasharray: `${px(4)} ${px(3)}`,
            pointerEvents: 'all',
            cursor: 'text',
          }}
        />
      )}
      <text
        ref={textRef}
        x={x}
        y={y}
        textAnchor={align}
        style={{ font: `600 ${px(12)}px Figtree`, fill, pointerEvents: 'none', visibility: hidden ? 'hidden' : undefined }}
      >
        {name}
      </text>
      {show && (
        <g
          data-bed-label-grip={bedId}
          transform={`translate(${left + w + px(3)} ${top})`}
          onPointerDown={onGripDown}
          style={{ cursor: gripCursor }}
        >
          <rect width={gripW} height={h} rx={px(4)} style={{ fill: strong ? accent : outline }} />
          {[0.3, 0.5, 0.7].flatMap((fy) =>
            [0.35, 0.65].map((fx) => (
              <circle key={`${fy}-${fx}`} cx={gripW * fx} cy={h * fy} r={px(1.1)} style={{ fill: '#fff', pointerEvents: 'none' }} />
            )),
          )}
        </g>
      )}
    </g>
  );
}
