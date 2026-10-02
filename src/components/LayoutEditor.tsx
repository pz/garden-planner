import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useGarden } from '../state/gardenStore';
import { popSnapshot, pushSnapshot, type LayoutSnapshot } from '../state/layoutHistory';
import { storageKey } from '../state/storageNamespace';
import type { Bed, PlantInstance } from '../types';
import type { Point } from '../utils/geometry';
import {
  LAYOUT_SNAP_IN,
  bedToGarden,
  boxBetween,
  drawnCornerRadius,
  fitView,
  formatLength,
  gardenBounds,
  isDrag,
  nextBedName,
  normalizeSide,
  panBy,
  parseLength,
  plantSummary,
  rectFromCorners,
  relocatePlants,
  resizeBedTo,
  resizeFromPointer,
  screenToGarden,
  snapTo,
  wheelZoomFactor,
  zoomAt,
  zoomPercent,
  type BedGeometry,
  type Handle,
  type Insets,
  type View,
} from '../utils/layout';
import { CROP_COLORS } from './PlantMark';
import { Icon, type IconName } from './Icon';

/** Palette from the layout editor design; the app's shared tokens don't have these steps yet. */
const C = {
  ground: '#f9f4ed',
  grid: '#dcd3c4',
  bed: 'var(--color-surface)',
  bedStroke: '#645c50',
  muted: '#645c50',
  faint: '#a19786',
  pill: '#f9f4ed',
  pillText: '#645c50',
  pillStrong: '#fff2eb',
  pillStrongText: '#643312',
  draft: '#fff2eb',
  warn: 'oklch(0.55 0.19 28)',
  deleteBtn: '#dcd3c4',
};

/** Room kept clear of the overlaid tool rail, side panel, and hint bar when fitting the garden. */
const FIT_INSETS: Insets = { left: 80, right: 330, top: 40, bottom: 110 };
const HELP_HIDDEN_KEY = storageKey('garden-planner-layout-help-hidden');

type Tool = 'select' | 'rect';

type Drag =
  | { kind: 'pan'; startX: number; startY: number; view0: View; moved: boolean; deselectOnClick: boolean }
  | { kind: 'move'; bedId: string; start: Point; dx: number; dy: number }
  | { kind: 'resize'; bedId: string; handle: Handle; draft: Bed }
  | { kind: 'draw'; a: Point; b: Point };

type Pending =
  | { kind: 'resize'; bedId: string; draft: Bed; plantIds: string[] }
  | { kind: 'delete'; bedId: string; plantIds: string[] };

const EDGE_HANDLES: Handle[] = [
  { sx: 0, sy: -1 },
  { sx: 0, sy: 1 },
  { sx: -1, sy: 0 },
  { sx: 1, sy: 0 },
];
const CORNER_HANDLES: Handle[] = [
  { sx: -1, sy: -1 },
  { sx: 1, sy: -1 },
  { sx: 1, sy: 1 },
  { sx: -1, sy: 1 },
];

function resizeCursor(h: Handle): string {
  if (h.sx === 0) return 'ns-resize';
  if (h.sy === 0) return 'ew-resize';
  return h.sx === h.sy ? 'nwse-resize' : 'nesw-resize';
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl ';
const SHORTCUTS: [string, string][] = [
  ['V', 'Select'],
  ['R', 'Rectangle'],
  ['Space + drag', 'Pan'],
  [`${MOD}scroll`, 'Zoom'],
  ['0', 'Fit'],
  ['Arrows', `Nudge ${formatLength(LAYOUT_SNAP_IN)}`],
  ['Del', 'Delete'],
  [`${MOD}Z`, 'Undo'],
];

function readHelpHidden(): boolean {
  try {
    return localStorage.getItem(HELP_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function LayoutEditor() {
  const { plan, addBed, renameBed, moveBed, resizeBed, removeBed, restoreLayout } = useGarden();
  const { beds, plants } = plan;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [history, setHistory] = useState<LayoutSnapshot[]>([]);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [helpHidden, setHelpHidden] = useState(readHelpHidden);

  const selected = beds.find((b) => b.id === selectedId) ?? null;

  const fit = useCallback(() => {
    if (size) setView(fitView(gardenBounds(beds), size.w, size.h, FIT_INSETS));
  }, [size, beds]);

  // Track the viewport's size, and frame the garden the first time it's known.
  const bedsRef = useRef(beds);
  useEffect(() => {
    bedsRef.current = beds;
  }, [beds]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setSize({ w: r.width, h: r.height });
      setView((v) => v ?? fitView(gardenBounds(bedsRef.current), r.width, r.height, FIT_INSETS));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      if (size) setView((v) => v && zoomAt(v, size.w / 2, size.h / 2, factor));
    },
    [size],
  );

  // Wheel: pinch / ⌘-scroll zooms around the cursor, plain scroll pans. Needs a non-passive
  // listener so it can stop the page from scrolling or zooming too. The canvas only mounts
  // once the viewport has been measured, so (re)attach when it appears.
  const hasCanvas = !!(view && size);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        setView((v) => v && zoomAt(v, e.clientX - r.left, e.clientY - r.top, wheelZoomFactor(e.deltaY)));
      } else {
        setView((v) => v && panBy(v, -e.deltaX, -e.deltaY));
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasCanvas]);

  function gardenPoint(clientX: number, clientY: number): Point | null {
    const el = svgRef.current;
    if (!el || !view) return null;
    const r = el.getBoundingClientRect();
    return screenToGarden(view, clientX - r.left, clientY - r.top);
  }

  /** Records the current layout as an undo step, then applies an edit. */
  function commit(edit: () => void) {
    setHistory((h) => pushSnapshot(h, { beds, plants }));
    edit();
  }

  const undo = useCallback(() => {
    if (pending) return;
    const popped = popSnapshot(history);
    if (!popped) return;
    restoreLayout(popped.snapshot.beds, popped.snapshot.plants);
    setHistory(popped.rest);
    if (selectedId && !popped.snapshot.beds.some((b) => b.id === selectedId)) setSelectedId(null);
  }, [pending, history, restoreLayout, selectedId]);

  /** Applies a new size/position, asking first if it would leave plants outside the bed. */
  function applyGeometry(bed: Bed, draft: Bed) {
    const { outsideIds } = relocatePlants(bed, draft, plants);
    if (outsideIds.length) {
      setPending({ kind: 'resize', bedId: bed.id, draft, plantIds: outsideIds });
      return;
    }
    const geometry: BedGeometry = { cx: draft.cx, cy: draft.cy, widthIn: draft.widthIn, heightIn: draft.heightIn };
    commit(() => resizeBed(bed.id, geometry));
  }

  function setSizeFromPanel(bed: Bed, widthIn: number, heightIn: number) {
    if (pending) return;
    const w = normalizeSide(widthIn);
    const h = normalizeSide(heightIn);
    if (w === bed.widthIn && h === bed.heightIn) return;
    // The panel grows and shrinks a bed from its top-left corner.
    applyGeometry(bed, resizeBedTo(bed, w, h, { sx: 1, sy: 1 }));
  }

  function requestDelete(bed: Bed) {
    if (pending) return;
    const ids = plants.filter((p) => p.bedId === bed.id).map((p) => p.id);
    if (ids.length) {
      setPending({ kind: 'delete', bedId: bed.id, plantIds: ids });
      return;
    }
    commit(() => removeBed(bed.id));
    setSelectedId(null);
  }

  function confirmPending() {
    if (!pending) return;
    if (pending.kind === 'resize') {
      const d = pending.draft;
      commit(() => resizeBed(pending.bedId, { cx: d.cx, cy: d.cy, widthIn: d.widthIn, heightIn: d.heightIn }));
    } else {
      commit(() => removeBed(pending.bedId));
      setSelectedId(null);
    }
    setPending(null);
  }

  function pickTool(t: Tool) {
    setTool(t);
    setCursor(null);
    if (t !== 'select') setSelectedId(null);
  }

  // Keyboard shortcuts, ignored while typing in the side panel's fields.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === ' ') {
      e.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (!mod && (e.key === '=' || e.key === '+')) return zoomBy(1.25);
    if (!mod && e.key === '-') return zoomBy(0.8);
    if (!mod && e.key === '0') return fit();
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return undo();
    }
    if (pending) {
      if (e.key === 'Escape') setPending(null);
      if (e.key === 'Enter') confirmPending();
      return;
    }
    if (mod) return;
    if (e.key === 'Escape') {
      setSelectedId(null);
      pickTool('select');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      requestDelete(selected);
    } else if (e.key === 'v' || e.key === 'V') pickTool('select');
    else if (e.key === 'r' || e.key === 'R') pickTool('rect');
    else if (selected && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = LAYOUT_SNAP_IN;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      commit(() => moveBed(selected.id, dx, dy));
    }
  };
  useEffect(() => {
    keyRef.current = onKey;
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // --- pointer gestures ---------------------------------------------------------------

  function capture(e: React.PointerEvent) {
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function onCanvasDown(e: React.PointerEvent) {
    if (!view || e.button === 2) return;
    const forcePan = e.button === 1 || spaceHeld;
    if (pending && !forcePan) return;
    capture(e);
    if (forcePan || tool === 'select') {
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, view0: view, moved: false, deselectOnClick: !forcePan });
      return;
    }
    const p = gardenPoint(e.clientX, e.clientY);
    if (!p) return;
    const snapped = { x: snapTo(p.x), y: snapTo(p.y) };
    setSelectedId(null);
    setDrag({ kind: 'draw', a: snapped, b: snapped });
  }

  function onBedDown(e: React.PointerEvent, bed: Bed) {
    if (spaceHeld || e.button !== 0 || pending || tool !== 'select') return;
    e.stopPropagation();
    const p = gardenPoint(e.clientX, e.clientY);
    if (!p) return;
    capture(e);
    setSelectedId(bed.id);
    setDrag({ kind: 'move', bedId: bed.id, start: p, dx: 0, dy: 0 });
  }

  function onHandleDown(e: React.PointerEvent, bed: Bed, handle: Handle) {
    if (e.button !== 0 || pending) return;
    e.stopPropagation();
    capture(e);
    setDrag({ kind: 'resize', bedId: bed.id, handle, draft: bed });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (drag?.kind === 'pan') {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const moved = drag.moved || isDrag(dx, dy);
      setView(panBy(drag.view0, dx, dy));
      if (moved !== drag.moved) setDrag({ ...drag, moved });
      return;
    }
    const p = gardenPoint(e.clientX, e.clientY);
    if (!p) return;
    if (!drag) {
      if (tool !== 'select' && !pending) {
        const c = { x: snapTo(p.x), y: snapTo(p.y) };
        if (!cursor || cursor.x !== c.x || cursor.y !== c.y) setCursor(c);
      }
      return;
    }
    if (drag.kind === 'draw') {
      setDrag({ ...drag, b: { x: snapTo(p.x), y: snapTo(p.y) } });
      setCursor({ x: snapTo(p.x), y: snapTo(p.y) });
    } else if (drag.kind === 'move') {
      setDrag({ ...drag, dx: snapTo(p.x - drag.start.x), dy: snapTo(p.y - drag.start.y) });
    } else if (drag.kind === 'resize') {
      const bed = beds.find((b) => b.id === drag.bedId);
      if (bed) setDrag({ ...drag, draft: resizeFromPointer(bed, drag.handle, p) });
    }
  }

  function onPointerUp() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'pan') {
      if (d.deselectOnClick && !d.moved) setSelectedId(null);
    } else if (d.kind === 'draw') {
      const geometry = rectFromCorners(d.a, d.b);
      setCursor(null);
      if (!geometry) return;
      const bed: Bed = { id: crypto.randomUUID(), name: nextBedName(beds), shape: 'rect', rotationDeg: 0, ...geometry };
      commit(() => addBed(bed));
      setSelectedId(bed.id);
      setTool('select');
    } else if (d.kind === 'move') {
      if (d.dx !== 0 || d.dy !== 0) commit(() => moveBed(d.bedId, d.dx, d.dy));
    } else if (d.kind === 'resize') {
      const bed = beds.find((b) => b.id === d.bedId);
      if (bed && (d.draft.widthIn !== bed.widthIn || d.draft.heightIn !== bed.heightIn)) applyGeometry(bed, d.draft);
    }
  }

  // --- what to draw ----------------------------------------------------------------------

  /** A bed as it should look right now, with any in-progress drag or pending resize applied. */
  function displayed(bed: Bed): Bed {
    if (drag?.kind === 'move' && drag.bedId === bed.id) return { ...bed, cx: bed.cx + drag.dx, cy: bed.cy + drag.dy };
    if (drag?.kind === 'resize' && drag.bedId === bed.id) return drag.draft;
    if (pending?.kind === 'resize' && pending.bedId === bed.id) return pending.draft;
    return bed;
  }

  // While a bed is being resized its plants hold still in the garden, and the ones its new
  // outline would lose are flagged.
  const resizing = drag?.kind === 'resize' ? drag : pending?.kind === 'resize' ? pending : null;
  const resizingFrom = resizing ? beds.find((b) => b.id === resizing.bedId) : undefined;
  const flagged = new Set<string>(
    pending ? pending.plantIds : resizing && resizingFrom ? relocatePlants(resizingFrom, resizing.draft, plants).outsideIds : [],
  );

  function plantPoint(p: PlantInstance, bedById: Map<string, Bed>): Point | null {
    const bed = bedById.get(p.bedId);
    if (!bed) return null;
    return bedToGarden(resizing?.bedId === bed.id ? bed : displayed(bed), p);
  }

  const zoom = view?.zoom ?? 1;
  const px = (v: number) => v / zoom;
  const bedById = new Map(beds.map((b) => [b.id, b]));

  function pill(key: string, at: Point, text: string, strong: boolean): ReactNode {
    const fs = px(11);
    const tw = text.length * fs * 0.56 + px(10);
    const th = fs * 1.6;
    return (
      <g key={key} transform={`translate(${at.x} ${at.y})`} style={{ pointerEvents: 'none' }}>
        <rect
          x={-tw / 2}
          y={-th / 2}
          width={tw}
          height={th}
          rx={th / 2}
          style={{ fill: strong ? C.pillStrong : C.pill, fillOpacity: 0.94 }}
        />
        <text
          dy="0.35em"
          textAnchor="middle"
          style={{ font: `500 ${fs}px Figtree`, fill: strong ? C.pillStrongText : C.pillText }}
        >
          {text}
        </text>
      </g>
    );
  }

  /** Width below the bottom edge and length right of the right edge, clear of the outline. */
  function dimensionPills(key: string, g: BedGeometry, strong: boolean): ReactNode[] {
    const off = px(strong ? 14 : 10);
    const lengthText = formatLength(g.heightIn);
    const lengthHalfW = (lengthText.length * px(11) * 0.56 + px(10)) / 2;
    return [
      pill(`${key}-w`, { x: g.cx, y: g.cy + g.heightIn / 2 + off }, formatLength(g.widthIn), strong),
      pill(`${key}-h`, { x: g.cx + g.widthIn / 2 + off / 2 + lengthHalfW, y: g.cy }, lengthText, strong),
    ];
  }

  const draft = drag?.kind === 'draw' ? rectFromCorners(drag.a, drag.b) : null;
  const drawBox = drag?.kind === 'draw' ? boxBetween(drag.a, drag.b) : null;

  const canvasCursor =
    drag?.kind === 'pan' && drag.moved ? 'grabbing' : spaceHeld ? 'grab' : tool !== 'select' ? 'crosshair' : 'default';

  const hint =
    tool === 'rect'
      ? `Drag to draw a bed. Sides snap to ${formatLength(LAYOUT_SNAP_IN)}.`
      : selected
        ? 'Drag the bed to move it, or its edges and corners to resize it.'
        : beds.length
          ? 'Click a bed to edit it, or pick the rectangle tool to add one.'
          : 'Pick the rectangle tool, then drag to draw your first bed.';

  function toggleHelp() {
    const next = !helpHidden;
    setHelpHidden(next);
    try {
      localStorage.setItem(HELP_HIDDEN_KEY, next ? '1' : '');
    } catch {
      // Private mode or blocked storage: the preference just won't stick.
    }
  }

  const pendingBed = pending ? bedById.get(pending.bedId) : null;
  const pendingPlants = pending ? plants.filter((p) => pending.plantIds.includes(p.id)) : [];
  const nPending = pendingPlants.length;
  const plantWord = `${nPending} plant${nPending === 1 ? '' : 's'}`;

  return (
    <div
      ref={wrapRef}
      data-testid="layout-editor"
      style={{
        position: 'relative',
        height: 'max(460px, calc(100vh - 150px))',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1.5px solid var(--color-divider)',
        background: C.ground,
      }}
    >
      {view && size && (
        <svg
          ref={svgRef}
          data-garden-layout=""
          viewBox={`${view.x} ${view.y} ${size.w / view.zoom} ${size.h / view.zoom}`}
          onPointerDown={onCanvasDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            touchAction: 'none',
            userSelect: 'none',
            cursor: canvasCursor,
          }}
        >
          <defs>
            <pattern id="layout-grid-1ft" width={12} height={12} patternUnits="userSpaceOnUse">
              <path d="M12 0H0V12" style={{ fill: 'none', stroke: C.grid, strokeWidth: px(1) }} />
            </pattern>
          </defs>
          {zoom >= 0.8 && (
            <rect
              x={view.x}
              y={view.y}
              width={size.w / zoom}
              height={size.h / zoom}
              style={{ fill: 'url(#layout-grid-1ft)', pointerEvents: 'none' }}
            />
          )}

          {beds.map((bed) => {
            const b = displayed(bed);
            const isSel = bed.id === selectedId;
            return (
              <g key={bed.id} transform={`translate(${b.cx} ${b.cy}) rotate(${b.rotationDeg})`}>
                <rect
                  data-bed-id={bed.id}
                  x={-b.widthIn / 2}
                  y={-b.heightIn / 2}
                  width={b.widthIn}
                  height={b.heightIn}
                  rx={drawnCornerRadius(b)}
                  onPointerDown={(e) => onBedDown(e, bed)}
                  onPointerEnter={() => setHoverId(bed.id)}
                  onPointerLeave={() => setHoverId((h) => (h === bed.id ? null : h))}
                  style={{
                    fill: C.bed,
                    stroke: isSel ? 'var(--color-accent)' : C.bedStroke,
                    strokeWidth: px(isSel ? 3.5 : 1.5),
                    cursor: tool === 'select' && !pending && !spaceHeld ? 'move' : undefined,
                  }}
                />
              </g>
            );
          })}

          {beds.map((bed) => {
            const b = displayed(bed);
            return (
              <text
                key={`name-${bed.id}`}
                x={b.cx - b.widthIn / 2}
                y={b.cy - b.heightIn / 2 - px(7)}
                style={{ font: `600 ${px(12)}px Figtree`, fill: C.muted, pointerEvents: 'none' }}
              >
                {bed.name}
              </text>
            );
          })}

          {plants.map((p) => {
            const at = plantPoint(p, bedById);
            if (!at) return null;
            const hot = flagged.has(p.id);
            return (
              <g key={p.id} transform={`translate(${at.x} ${at.y})`} style={{ pointerEvents: 'none' }}>
                {hot && (
                  <circle
                    r={px(11)}
                    style={{ fill: C.warn, fillOpacity: 0.16, stroke: C.warn, strokeWidth: px(2.5) }}
                  />
                )}
                <circle
                  r={px(5)}
                  style={{ fill: hot ? C.warn : CROP_COLORS[p.cropId] ?? C.muted, opacity: hot ? 1 : 0.55 }}
                />
              </g>
            );
          })}

          {beds.flatMap((bed) => {
            const isSel = bed.id === selectedId;
            if (!isSel && bed.id !== hoverId) return [];
            return dimensionPills(bed.id, displayed(bed), isSel);
          })}

          {selected && !drawBox && (() => {
            const b = displayed(selected);
            const hw = b.widthIn / 2;
            const hh = b.heightIn / 2;
            const hit = { stroke: 'transparent', strokeWidth: px(14), fill: 'none', pointerEvents: 'stroke' as const };
            return (
              <g transform={`translate(${b.cx} ${b.cy}) rotate(${b.rotationDeg})`}>
                {EDGE_HANDLES.map((h) => (
                  <line
                    key={`e${h.sx}${h.sy}`}
                    data-handle={`${h.sx},${h.sy}`}
                    x1={h.sx ? h.sx * hw : -hw}
                    x2={h.sx ? h.sx * hw : hw}
                    y1={h.sy ? h.sy * hh : -hh}
                    y2={h.sy ? h.sy * hh : hh}
                    onPointerDown={(e) => onHandleDown(e, selected, h)}
                    style={{ ...hit, cursor: resizeCursor(h) }}
                  />
                ))}
                {CORNER_HANDLES.map((h) => (
                  <circle
                    key={`c${h.sx}${h.sy}`}
                    data-handle={`${h.sx},${h.sy}`}
                    cx={h.sx * hw}
                    cy={h.sy * hh}
                    r={px(10)}
                    onPointerDown={(e) => onHandleDown(e, selected, h)}
                    style={{ fill: 'transparent', cursor: resizeCursor(h) }}
                  />
                ))}
              </g>
            );
          })()}

          {drawBox && (
            <rect
              x={drawBox.x}
              y={drawBox.y}
              width={drawBox.width}
              height={drawBox.height}
              rx={2}
              style={{
                fill: C.draft,
                fillOpacity: 0.7,
                stroke: 'var(--color-accent)',
                strokeOpacity: draft ? 1 : 0.5,
                strokeWidth: px(2),
                strokeDasharray: `${px(6)} ${px(4)}`,
                pointerEvents: 'none',
              }}
            />
          )}
          {drawBox && draft && dimensionPills('draft', draft, true)}

          {tool !== 'select' && cursor && !pending && (
            <circle cx={cursor.x} cy={cursor.y} r={px(3.5)} style={{ fill: 'var(--color-accent)', pointerEvents: 'none' }} />
          )}
        </svg>
      )}

      {/* Tool rail */}
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 8,
          borderRadius: 999,
          background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <ToolButton icon="select" title="Select (V)" active={tool === 'select'} onClick={() => pickTool('select')} />
        <ToolButton icon="rect" title="Rectangle bed (R)" active={tool === 'rect'} onClick={() => pickTool('rect')} />
        <div style={{ height: 8 }} />
        <ToolButton icon="undo" title={`Undo (${MOD}Z)`} disabled={!history.length || !!pending} onClick={undo} />
      </div>

      {/* Hint + shortcuts */}
      {!pending && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            width: 'min(600px, calc(100% - 340px))',
            minWidth: 240,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 12px 12px 18px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span data-testid="layout-hint" style={{ flex: 1, minWidth: 0, font: '400 13px Figtree', color: '#474238' }}>
              {hint}
            </span>
            <button className="btn btn-ghost" onClick={toggleHelp} style={{ font: '600 12.5px Figtree', flex: 'none' }}>
              {helpHidden ? 'Shortcuts' : 'Hide shortcuts'}
            </button>
          </div>
          {!helpHidden && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', font: '400 12px Figtree', color: C.muted }}>
              {SHORTCUTS.map(([k, d]) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <b
                    style={{
                      padding: '1px 7px',
                      borderRadius: 999,
                      background: 'var(--color-surface)',
                      color: '#2e2b25',
                      fontWeight: 600,
                    }}
                  >
                    {k}
                  </b>
                  <span>{d}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Zoom */}
      {view && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 4,
            borderRadius: 999,
            background: 'var(--color-bg)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <ToolButton icon="minus" title="Zoom out (−)" small onClick={() => zoomBy(0.8)} />
          <button
            className="btn btn-secondary"
            title="Fit garden (0)"
            onClick={fit}
            style={{ borderColor: 'transparent', minWidth: 58, padding: '6px 8px', font: '600 13px Figtree' }}
          >
            {zoomPercent(view)}%
          </button>
          <ToolButton icon="plus" title="Zoom in (+)" small onClick={() => zoomBy(1.25)} />
          <ToolButton icon="fit" title="Fit garden (0)" small onClick={fit} />
        </div>
      )}

      {/* Side panel */}
      <aside
        style={{
          position: 'absolute',
          right: 16,
          top: 16,
          width: 288,
          maxHeight: 'calc(100% - 96px)',
          overflow: 'auto',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {selected ? (
          <BedPanel
            key={selected.id}
            // Shows the live size while an edge is dragged or a resize awaits confirmation.
            bed={displayed(selected)}
            plantCount={plants.filter((p) => p.bedId === selected.id).length}
            onBack={() => setSelectedId(null)}
            onRename={(name) => renameBed(selected.id, name)}
            onSize={(w, h) => setSizeFromPanel(selected, w, h)}
            onDelete={() => requestDelete(selected)}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px 14px', background: 'var(--color-bg)', font: '700 19px Figtree' }}>Beds</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 16 }}>
              {beds.length === 0 && (
                <p style={{ font: '400 13px Figtree', color: C.muted }}>No beds yet. Draw one with the rectangle tool.</p>
              )}
              {beds.map((b) => (
                <button
                  key={b.id}
                  className="btn btn-secondary"
                  onClick={() => {
                    setSelectedId(b.id);
                    pickTool('select');
                  }}
                  style={{ justifyContent: 'space-between', width: '100%', font: '600 13.5px Figtree' }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                  <span style={{ font: '400 12px Figtree', color: C.muted, flex: 'none' }}>
                    {formatLength(b.widthIn)} × {formatLength(b.heightIn)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Confirm before plants are removed */}
      {pending && pendingBed && (
        <div
          role="dialog"
          aria-label="Confirm"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 16,
            transform: 'translateX(-50%)',
            width: 'min(460px, calc(100% - 32px))',
            padding: '18px 20px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-surface-raised)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ font: '700 16px Figtree' }}>
            {pending.kind === 'resize' ? `Remove ${plantWord}?` : `Delete ${pendingBed.name}?`}
          </div>
          <p style={{ font: '400 13.5px/1.5 Figtree', color: C.muted }}>
            {pending.kind === 'resize'
              ? `At ${formatLength(pending.draft.widthIn)} × ${formatLength(pending.draft.heightIn)}, ${plantWord} (${plantSummary(pendingPlants)}) fall outside ${pendingBed.name}. Resizing removes them from the plan.`
              : `Its ${plantWord} (${plantSummary(pendingPlants)}) will be removed from the plan too.`}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button className="btn btn-secondary" onClick={() => setPending(null)}>
              Keep plants
            </button>
            <button className="btn btn-primary" onClick={confirmPending}>
              {pending.kind === 'resize' ? 'Resize and remove' : 'Delete bed'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  icon,
  title,
  onClick,
  active = false,
  disabled = false,
  small = false,
}: {
  icon: IconName;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  const s = small ? 32 : 38;
  return (
    <button
      className={active ? 'btn btn-primary' : 'btn btn-secondary'}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: s,
        height: s,
        padding: 0,
        borderRadius: 999,
        justifyContent: 'center',
        borderColor: active ? undefined : 'transparent',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Icon name={icon} size={small ? 16 : 17} />
    </button>
  );
}

function BedPanel({
  bed,
  plantCount,
  onBack,
  onRename,
  onSize,
  onDelete,
}: {
  bed: Bed;
  plantCount: number;
  onBack: () => void;
  onRename: (name: string) => void;
  onSize: (widthIn: number, heightIn: number) => void;
  onDelete: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  /** The name as it was when editing started, restored on Esc or if the field is left blank. */
  const [nameBefore, setNameBefore] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 12px 10px', background: 'var(--color-bg)' }}>
        <button
          className="btn btn-ghost"
          title="Back to all beds (Esc)"
          aria-label="Back to all beds"
          onClick={onBack}
          style={{ width: 34, height: 34, padding: 0, justifyContent: 'center', color: C.muted }}
        >
          <Icon name="back" />
        </button>
        <input
          ref={nameRef}
          aria-label="Bed name"
          value={bed.name}
          onFocus={(e) => {
            setNameBefore(bed.name);
            e.target.select();
          }}
          onChange={(e) => onRename(e.target.value)}
          onBlur={() => {
            if (nameBefore !== null && !bed.name.trim()) onRename(nameBefore);
            setNameBefore(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape' && nameBefore !== null) {
              onRename(nameBefore);
              e.currentTarget.blur();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            font: '700 19px Figtree',
            color: 'var(--color-text)',
            background: nameBefore !== null ? C.ground : 'transparent',
            border: 'none',
            borderRadius: 8,
            padding: '3px 6px',
            outline: 'none',
          }}
        />
        {nameBefore === null ? (
          <button
            className="btn btn-ghost"
            title="Rename bed"
            aria-label="Rename bed"
            onClick={() => nameRef.current?.focus()}
            style={{ width: 34, height: 34, padding: 0, justifyContent: 'center', color: C.faint }}
          >
            <Icon name="pencil" size={16} />
          </button>
        ) : (
          <button
            className="btn btn-primary"
            title="Save name (Enter)"
            aria-label="Save name"
            // pointerdown, not click: the input's blur (which saves) must not beat the press.
            onPointerDown={(e) => {
              e.preventDefault();
              nameRef.current?.blur();
            }}
            style={{ width: 34, height: 34, padding: 0, justifyContent: 'center', borderRadius: 999 }}
          >
            <Icon name="check" size={16} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ font: '700 11px Figtree', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
            Size
          </span>
          <LengthRow
            label="Width"
            value={bed.widthIn}
            onStep={(d) => onSize(bed.widthIn + d, bed.heightIn)}
            onCommit={(v) => onSize(v, bed.heightIn)}
          />
          <LengthRow
            label="Length"
            value={bed.heightIn}
            onStep={(d) => onSize(bed.widthIn, bed.heightIn + d)}
            onCommit={(v) => onSize(bed.widthIn, v)}
          />
        </div>
        <p style={{ font: '400 13px Figtree', color: C.muted }}>
          {plantCount
            ? `${plantCount} ${plantCount === 1 ? 'plant moves' : 'plants move'} with this bed.`
            : 'No plants in this bed yet.'}
        </p>
        <button
          className="btn"
          onClick={onDelete}
          style={{ width: '100%', justifyContent: 'center', background: C.deleteBtn, color: 'var(--color-text)' }}
        >
          <Icon name="trash" size={16} />
          Delete bed
        </button>
      </div>
    </div>
  );
}

function LengthRow({
  label,
  value,
  onStep,
  onCommit,
}: {
  label: string;
  value: number;
  onStep: (delta: number) => void;
  onCommit: (inches: number) => void;
}) {
  /** What's typed while the field has focus; null when it just shows the bed's size. */
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const stepBtn = { width: 32, height: 32, padding: 0, justifyContent: 'center', borderRadius: 999 } as const;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, font: '400 14px Figtree' }}>{label}</span>
      <button className="btn btn-secondary" title={`Shrink ${label.toLowerCase()}`} aria-label={`Shrink ${label.toLowerCase()}`} onClick={() => onStep(-LAYOUT_SNAP_IN)} style={stepBtn}>
        <Icon name="minus" size={15} />
      </button>
      <input
        aria-label={label}
        value={text ?? formatLength(value)}
        onFocus={(e) => {
          cancelled.current = false;
          setText(formatLength(value));
          const el = e.target;
          setTimeout(() => el.select(), 0);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = text === null || cancelled.current ? null : parseLength(text);
          setText(null);
          if (parsed !== null) onCommit(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        style={{
          width: 76,
          minHeight: 32,
          padding: '4px 8px',
          textAlign: 'center',
          font: '600 14px Figtree',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--color-text)',
          background: 'var(--color-bg)',
          border: '1.5px solid var(--color-divider)',
          borderRadius: 10,
        }}
      />
      <button className="btn btn-secondary" title={`Grow ${label.toLowerCase()}`} aria-label={`Grow ${label.toLowerCase()}`} onClick={() => onStep(LAYOUT_SNAP_IN)} style={stepBtn}>
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}
