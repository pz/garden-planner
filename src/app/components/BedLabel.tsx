import { useLayoutEffect, useRef, useState } from 'react';

/**
 * A bed's name on the layout canvas. Pressing it and letting go edits the name (text cursor);
 * pressing and dragging moves it. While the label is hovered, its bed is selected or it is being
 * moved, a hairline dashed outline and a small dotted hint at its end say it can be dragged. The
 * text, outline and hint share one hover area with no gaps, so the pointer can travel from the
 * text to the hint. While the name is being renamed nothing is drawn (an input stands in for it).
 * `x`/`y` are the text's anchor and baseline in garden inches; `zoom` keeps the outline and hint
 * a constant size on screen.
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
  moving,
  hidden,
  onPress,
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
  /** Show the outline and hint. */
  active: boolean;
  /** Being dragged: draw the outline in the accent colour. */
  moving: boolean;
  /** The name is being edited in an input, so draw nothing. */
  hidden: boolean;
  /** A left press on the label; `onHint` when it landed on the dotted hint, which only ever drags. */
  onPress: (e: React.PointerEvent, onHint: boolean) => void;
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
  const hintW = px(14);
  const left = (align === 'middle' ? x - box.w / 2 : x) - pad;
  const top = y + box.dy - pad;
  const textW = box.w + pad * 2;
  const h = box.h + pad * 2;
  const measured = box.w > 0;
  const live = interactive && !hidden;
  const show = live && active && measured;
  const down = (onHint: boolean) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Stop the press here so it doesn't pan the canvas or deselect the bed.
    e.stopPropagation();
    onPress(e, onHint);
  };

  return (
    <g data-bed-label={bedId} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)} style={{ visibility: hidden ? 'hidden' : undefined }}>
      <text ref={textRef} x={x} y={y} textAnchor={align} style={{ font: `600 ${px(12)}px Figtree`, fill, pointerEvents: 'none' }}>
        {name}
      </text>
      {live && measured && (
        <>
          {/* One transparent target over the text and the hint, so hovering never falls through between them. */}
          <rect
            x={left}
            y={top}
            width={textW}
            height={h}
            data-bed-name={bedId}
            onPointerDown={down(false)}
            style={{ fill: 'transparent', pointerEvents: 'all', cursor: 'text' }}
          />
          <rect
            x={left + textW}
            y={top}
            width={hintW}
            height={h}
            data-bed-label-hint={bedId}
            onPointerDown={down(true)}
            style={{ fill: 'transparent', pointerEvents: 'all', cursor: 'move' }}
          />
        </>
      )}
      {show && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={left}
            y={top}
            width={textW + hintW}
            height={h}
            rx={px(4)}
            style={{ fill: 'none', stroke: moving ? accent : outline, strokeWidth: px(1), strokeDasharray: `${px(3)} ${px(3)}` }}
          />
          {[0.3, 0.5, 0.7].flatMap((fy) =>
            [0.35, 0.65].map((fx) => (
              <circle
                key={`${fy}-${fx}`}
                cx={left + textW + hintW * fx}
                cy={top + h * fy}
                r={px(1)}
                style={{ fill: moving ? accent : outline }}
              />
            )),
          )}
        </g>
      )}
    </g>
  );
}
