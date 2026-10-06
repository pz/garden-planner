import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useGarden } from '../state/gardenStore';
import { popSnapshot, pushSnapshot, type LayoutSnapshot } from '../state/layoutHistory';
import { storageKey } from '../state/storageNamespace';
import type { Bed, PlantInstance } from '../types';
import type { Point } from '../utils/geometry';
import {
  LAYOUT_SNAP_IN,
  ROTATION_STEP_DEG,
  bedToGarden,
  boxCorners,
  cloneBed,
  boxBetween,
  closesPolygon,
  drawnCornerRadius,
  edgeLabels,
  fitView,
  gardenToScreen,
  formatLength,
  gardenBounds,
  geometryOf,
  isDrag,
  labelAnchor,
  labelOffset,
  moveCorner,
  nextBedName,
  normalizeCornerRadius,
  normalizeSide,
  panBy,
  parseAngle,
  parseLength,
  plantSummary,
  polygonFromCorners,
  rectFromCorners,
  relocatePlants,
  resizeBedTo,
  resizeCursor,
  resizeSnapped,
  magneticAngle,
  rotationFromPointer,
  alignTargets,
  moveSnapped,
  type Guide,
  stepAngle,
  type SnapOptions,
  screenToGarden,
  snapTo,
  wheelZoomFactor,
  zoomAt,
  zoomPercent,
  type BedPlacement,
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

type Tool = 'select' | 'rect' | 'ellipse' | 'polygon';


type Drag =
  | { kind: 'pan'; startX: number; startY: number; view0: View; moved: boolean; deselectOnClick: boolean }
  | { kind: 'move'; bedId: string; start: Point; dx: number; dy: number; guides: Guide[] }
  | { kind: 'resize'; bedId: string; handle: Handle; draft: Bed; guides: Guide[] }
  | { kind: 'corner'; bedId: string; index: number; draft: Bed }
  | { kind: 'rotate'; bedId: string; rotationDeg: number }
  | { kind: 'draw'; a: Point; b: Point };

type Pending =
  | { kind: 'resize'; bedId: string; draft: Bed; plantIds: string[]; change: 'size' | 'corner' | 'radius' }
  | { kind: 'delete'; bedId: string; plantIds: string[] };

const EDGE_HANDLES: Handle[] = [
  { sx: 0, sy: -1 },
  { sx: 0, sy: 1 },
  { sx: -1, sy: 0 },
  { sx: 1, sy: 0 },
];
/** Each paste of the same copy lands this much further down and to the right. */
const PASTE_OFFSET_IN = 12;

const CORNER_HANDLES: Handle[] = [
  { sx: -1, sy: -1 },
  { sx: 1, sy: -1 },
  { sx: 1, sy: 1 },
  { sx: -1, sy: 1 },
];

const RESIZE_CONFIRM_LABEL = { size: 'Resize and remove', corner: 'Reshape and remove', radius: 'Round and remove' } as const;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl ';
const SHORTCUTS: [string, string][] = [
  ['V', 'Select'],
  ['R', 'Rectangle'],
  ['E', 'Ellipse'],
  ['P', 'Polygon'],
  ['Space + drag', 'Pan'],
  [`${MOD}scroll`, 'Zoom'],
  ['0', 'Fit'],
  ['Arrows', `Nudge ${formatLength(LAYOUT_SNAP_IN)}`],
  ['Shift + arrows', 'Nudge 1″'],
  ['Alt + drag', 'No snapping'],
  [`${MOD}C`, 'Copy'],
  [`${MOD}X`, 'Cut'],
  [`${MOD}V`, 'Paste'],
  [`${MOD}D`, 'Duplicate'],
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
  const { plan, addBed, renameBed, moveBed, reshapeBed, rotateBed, pasteBed, removeBed, restoreLayout } = useGarden();
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
  /**
   * The bed last copied or cut (as it was then, with its plants), and how many times it's been
   * pasted: each paste lands a further step down and to the right so copies don't stack.
   */
  const clipboard = useRef<{ bed: Bed; plants: PlantInstance[]; pastes: number } | null>(null);
  /** Corners placed so far while drawing a polygon, in garden coordinates. */
  const [corners, setCorners] = useState<Point[]>([]);
  const [helpHidden, setHelpHidden] = useState(readHelpHidden);
  /** The bed whose name is being edited in place on the canvas. */
  const [editingNameId, setEditingNameId] = useState<string | null>(null);

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

  /** Snapping for an edit at the current zoom; holding Alt turns the marks off. */
  function snapOf(e: { altKey: boolean }): SnapOptions {
    return { zoom: view?.zoom ?? 1, free: e.altKey };
  }

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
  function applyGeometry(bed: Bed, draft: Bed, change: 'size' | 'corner' | 'radius' = 'size') {
    const { outsideIds } = relocatePlants(bed, draft, plants);
    if (outsideIds.length) {
      setPending({ kind: 'resize', bedId: bed.id, draft, plantIds: outsideIds, change });
      return;
    }
    commit(() => reshapeBed(bed.id, geometryOf(draft)));
  }

  function setSizeFromPanel(bed: Bed, widthIn: number, heightIn: number) {
    if (pending) return;
    const w = normalizeSide(widthIn);
    const h = normalizeSide(heightIn);
    if (w === bed.widthIn && h === bed.heightIn) return;
    // The panel grows and shrinks a bed from its top-left corner.
    applyGeometry(bed, resizeBedTo(bed, w, h, { sx: 1, sy: 1 }));
  }

  function setRadiusFromPanel(bed: Bed, inches: number) {
    if (pending) return;
    const r = normalizeCornerRadius(inches, bed);
    if (r === drawnCornerRadius(bed)) return;
    applyGeometry(bed, { ...bed, cornerRadiusIn: r }, 'radius');
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
      commit(() => reshapeBed(pending.bedId, geometryOf(d)));
    } else {
      commit(() => removeBed(pending.bedId));
      setSelectedId(null);
    }
    setPending(null);
  }

  function pickTool(t: Tool) {
    setTool(t);
    setCursor(null);
    setCorners([]);
    if (t !== 'select') setSelectedId(null);
  }

  /** Turns the corners placed so far into a polygon bed, or drops them if they don't make one. */
  function finishPolygon() {
    const geometry = polygonFromCorners(corners);
    setCorners([]);
    if (!geometry) return;
    const bed: Bed = { id: crypto.randomUUID(), name: nextBedName(beds), shape: 'polygon', rotationDeg: 0, ...geometry };
    commit(() => addBed(bed));
    setSelectedId(bed.id);
    setTool('select');
    setCursor(null);
  }

  function setRotation(bed: Bed, deg: number) {
    if (pending) return;
    // Typed and stepped angles are taken to the degree; only the drag handle has marks to stick to.
    const rotationDeg = magneticAngle(deg, true);
    if (rotationDeg !== bed.rotationDeg) commit(() => rotateBed(bed.id, rotationDeg));
  }

  function copySelected() {
    if (!selected) return;
    clipboard.current = { bed: selected, plants: plants.filter((p) => p.bedId === selected.id), pastes: 0 };
  }

  function paste() {
    const clip = clipboard.current;
    if (!clip) return;
    clip.pastes += 1;
    const copy = cloneBed(clip.bed, clip.plants, PASTE_OFFSET_IN * clip.pastes, () => crypto.randomUUID(), beds);
    commit(() => pasteBed(copy.bed, copy.plants));
    setSelectedId(copy.bed.id);
    pickTool('select');
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
    if (mod) {
      // The clipboard holds one bed (and its plants); cut skips the delete confirmation since
      // the bed can be pasted back, and undo restores it either way.
      const k = e.key.toLowerCase();
      if (k === 'c' && selected) {
        e.preventDefault();
        copySelected();
      } else if (k === 'x' && selected) {
        e.preventDefault();
        copySelected();
        commit(() => removeBed(selected.id));
        setSelectedId(null);
      } else if (k === 'v' && clipboard.current) {
        e.preventDefault();
        paste();
      } else if (k === 'd' && selected) {
        e.preventDefault();
        copySelected();
        paste();
      }
      return;
    }
    if (e.key === 'Escape') {
      // First Esc abandons a half-drawn polygon; the next one leaves the drawing tool.
      if (corners.length) setCorners([]);
      else {
        setSelectedId(null);
        pickTool('select');
      }
    } else if (e.key === 'Enter' && tool === 'polygon') {
      finishPolygon();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      requestDelete(selected);
    } else if (e.key === 'v' || e.key === 'V') pickTool('select');
    else if (e.key === 'r' || e.key === 'R') pickTool('rect');
    else if (e.key === 'e' || e.key === 'E') pickTool('ellipse');
    else if (e.key === 'p' || e.key === 'P') pickTool('polygon');
    else if (selected && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : LAYOUT_SNAP_IN;
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
    if (tool === 'polygon') {
      // Polygons are clicked out corner by corner rather than dragged.
      if (closesPolygon(corners, snapped, view.zoom)) {
        finishPolygon();
        return;
      }
      const last = corners[corners.length - 1];
      if (!last || last.x !== snapped.x || last.y !== snapped.y) setCorners([...corners, snapped]);
      return;
    }
    setDrag({ kind: 'draw', a: snapped, b: snapped });
  }

  function onBedDown(e: React.PointerEvent, bed: Bed) {
    if (spaceHeld || e.button !== 0 || pending || tool !== 'select') return;
    e.stopPropagation();
    const p = gardenPoint(e.clientX, e.clientY);
    if (!p) return;
    capture(e);
    setSelectedId(bed.id);
    setDrag({ kind: 'move', bedId: bed.id, start: p, dx: 0, dy: 0, guides: [] });
  }

  /** Names are editable by clicking them, with the select tool. */
  const nameEditable = tool === 'select' && !pending && !spaceHeld;

  function onNameClick(e: React.MouseEvent, bed: Bed) {
    if (!nameEditable || e.button !== 0) return;
    setSelectedId(bed.id);
    setEditingNameId(bed.id);
  }

  function finishNameEdit(bed: Bed, name: string | null) {
    setEditingNameId(null);
    const trimmed = name?.trim();
    if (trimmed && trimmed !== bed.name) renameBed(bed.id, trimmed);
  }

  function onHandleDown(e: React.PointerEvent, bed: Bed, handle: Handle) {
    if (e.button !== 0 || pending) return;
    e.stopPropagation();
    capture(e);
    setDrag({ kind: 'resize', bedId: bed.id, handle, draft: bed, guides: [] });
  }

  function onRotateDown(e: React.PointerEvent, bed: Bed) {
    if (e.button !== 0 || pending) return;
    e.stopPropagation();
    capture(e);
    setDrag({ kind: 'rotate', bedId: bed.id, rotationDeg: bed.rotationDeg });
  }

  function onCornerDown(e: React.PointerEvent, bed: Bed, index: number) {
    if (e.button !== 0 || pending) return;
    e.stopPropagation();
    capture(e);
    setDrag({ kind: 'corner', bedId: bed.id, index, draft: bed });
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
      const bed = beds.find((b) => b.id === drag.bedId);
      if (!bed) return;
      // Moves go by the inch; the bed's sides and center line up with other beds and the grid.
      const moved = moveSnapped(
        bed,
        p.x - drag.start.x,
        p.y - drag.start.y,
        alignTargets(beds.filter((b) => b.id !== bed.id)),
        snapOf(e),
      );
      setDrag({ ...drag, dx: moved.dx, dy: moved.dy, guides: moved.guides });
    } else if (drag.kind === 'resize') {
      const bed = beds.find((b) => b.id === drag.bedId);
      if (!bed) return;
      const resized = resizeSnapped(bed, drag.handle, p, alignTargets(beds.filter((b) => b.id !== bed.id)), snapOf(e));
      setDrag({ ...drag, draft: resized.bed, guides: resized.guides });
    } else if (drag.kind === 'corner') {
      const bed = beds.find((b) => b.id === drag.bedId);
      if (bed) setDrag({ ...drag, draft: moveCorner(bed, drag.index, p, snapOf(e)) });
    } else if (drag.kind === 'rotate') {
      const bed = beds.find((b) => b.id === drag.bedId);
      if (bed) setDrag({ ...drag, rotationDeg: rotationFromPointer(bed, p, e.altKey) });
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
      const shape = tool === 'ellipse' ? 'ellipse' : 'rect';
      const bed: Bed = { id: crypto.randomUUID(), name: nextBedName(beds), shape, rotationDeg: 0, ...geometry };
      commit(() => addBed(bed));
      setSelectedId(bed.id);
      setTool('select');
    } else if (d.kind === 'move') {
      if (d.dx !== 0 || d.dy !== 0) commit(() => moveBed(d.bedId, d.dx, d.dy));
    } else if (d.kind === 'resize') {
      const bed = beds.find((b) => b.id === d.bedId);
      if (bed && (d.draft.widthIn !== bed.widthIn || d.draft.heightIn !== bed.heightIn)) applyGeometry(bed, d.draft);
    } else if (d.kind === 'corner') {
      const bed = beds.find((b) => b.id === d.bedId);
      if (bed && d.draft !== bed) applyGeometry(bed, d.draft, 'corner');
    } else if (d.kind === 'rotate') {
      const bed = beds.find((b) => b.id === d.bedId);
      if (bed) setRotation(bed, d.rotationDeg);
    }
  }

  // --- what to draw ----------------------------------------------------------------------

  /** A bed as it should look right now, with any in-progress drag or pending resize applied. */
  function displayed(bed: Bed): Bed {
    if (drag?.kind === 'move' && drag.bedId === bed.id) return { ...bed, cx: bed.cx + drag.dx, cy: bed.cy + drag.dy };
    if ((drag?.kind === 'resize' || drag?.kind === 'corner') && drag.bedId === bed.id) return drag.draft;
    if (drag?.kind === 'rotate' && drag.bedId === bed.id) return { ...bed, rotationDeg: drag.rotationDeg };
    if (pending?.kind === 'resize' && pending.bedId === bed.id) return pending.draft;
    return bed;
  }

  // While a bed is being resized or reshaped its plants hold still in the garden, and the ones
  // its new outline would lose are flagged.
  const resizing =
    drag?.kind === 'resize' || drag?.kind === 'corner' ? drag : pending?.kind === 'resize' ? pending : null;
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

  function plantDot(p: PlantInstance): ReactNode {
    const at = plantPoint(p, bedById);
    if (!at) return null;
    const hot = flagged.has(p.id);
    return (
      <g key={p.id} transform={`translate(${at.x} ${at.y})`} style={{ pointerEvents: 'none' }}>
        {hot && <circle r={px(11)} style={{ fill: C.warn, fillOpacity: 0.16, stroke: C.warn, strokeWidth: px(2.5) }} />}
        <circle r={px(5)} style={{ fill: hot ? C.warn : CROP_COLORS[p.cropId] ?? C.muted, opacity: hot ? 1 : 0.55 }} />
      </g>
    );
  }

  /** While an edge or corner is being dragged, the pills light up when a length sits on a foot mark. */
  const sizing = drag?.kind === 'resize' || drag?.kind === 'corner';
  const onFootMark = (inches: number) => Math.abs(inches / 12 - Math.round(inches / 12)) < 1e-6;

  function pill(key: string, at: Point, text: string, strong: boolean, snapped = false): ReactNode {
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
          style={{ fill: snapped ? 'var(--color-accent)' : strong ? C.pillStrong : C.pill, fillOpacity: 0.94 }}
        />
        <text
          dy="0.35em"
          textAnchor="middle"
          style={{ font: `500 ${fs}px Figtree`, fill: snapped ? '#fff' : strong ? C.pillStrongText : C.pillText }}
        >
          {text}
        </text>
      </g>
    );
  }

  /** Pills along edges, pushed out from the shape by enough to clear the line and the pill itself. */
  function edgePills(key: string, pts: Point[], closed: boolean, strong: boolean): ReactNode[] {
    return edgeLabels(pts, closed)
      .filter((l) => l.lengthIn * zoom >= 22) // too short on screen to label legibly
      .map((l, i) => {
        const text = formatLength(l.lengthIn);
        const halfW = (text.length * px(11) * 0.56 + px(10)) / 2;
        const halfH = (px(11) * 1.6) / 2;
        const off = labelOffset(l.outward, halfW, halfH, px(strong ? 10 : 6));
        return pill(`${key}-${i}`, { x: l.mid.x + l.outward.x * off, y: l.mid.y + l.outward.y * off }, text, strong, sizing && onFootMark(l.lengthIn));
      });
  }

  /** A bed's measurements: each side of a polygon, or the width and length of a rectangle or ellipse. */
  function bedPills(key: string, b: Bed, strong: boolean): ReactNode[] {
    if (b.points) return edgePills(key, b.points.map((q) => bedToGarden(b, q)), true, strong);
    return dimensionPills(key, b, strong);
  }

  /** Length beside the box's right side and width below its bottom one, turned with the bed. */
  function dimensionPills(key: string, g: BedPlacement, strong: boolean): ReactNode[] {
    // boxCorners runs top-left → top-right → bottom-right → bottom-left, so the closed outline's
    // second and third edges are the right and bottom sides.
    const [, right, bottom] = edgeLabels(boxCorners(g));
    return [right, bottom].map((l, i) => {
      const text = formatLength(l.lengthIn);
      const halfW = (text.length * px(11) * 0.56 + px(10)) / 2;
      const halfH = (px(11) * 1.6) / 2;
      const off = labelOffset(l.outward, halfW, halfH, px(strong ? 10 : 6));
      return pill(`${key}-${i}`, { x: l.mid.x + l.outward.x * off, y: l.mid.y + l.outward.y * off }, text, strong, sizing && onFootMark(l.lengthIn));
    });
  }

  const drawn = drag?.kind === 'draw' ? rectFromCorners(drag.a, drag.b) : null;
  const draft = drawn ? { ...drawn, rotationDeg: 0 } : null;
  const drawBox = drag?.kind === 'draw' ? boxBetween(drag.a, drag.b) : null;

  const canvasCursor =
    drag?.kind === 'pan' && drag.moved ? 'grabbing' : spaceHeld ? 'grab' : tool !== 'select' ? 'crosshair' : 'default';

  const hint =
    tool === 'rect'
      ? `Drag to draw a bed. Sides snap to ${formatLength(LAYOUT_SNAP_IN)}.`
      : tool === 'ellipse'
        ? `Drag to draw an ellipse. Its box snaps to ${formatLength(LAYOUT_SNAP_IN)}.`
        : tool === 'polygon'
          ? corners.length
            ? 'Click to add corners · click the first corner or press Enter to close · Esc cancels'
            : `Click to place the first corner. Corners snap to ${formatLength(LAYOUT_SNAP_IN)}.`
          : selected?.shape === 'polygon'
            ? 'Drag the bed to move it, its corners to reshape it, its box edges to resize it, or the handle above to turn it. Hold Alt to turn snapping off.'
            : selected
              ? 'Drag the bed to move it, its edges and corners to resize it, or the handle above to turn it. Hold Alt to turn snapping off.'
        : beds.length
          ? 'Click a bed to edit it, or pick a shape tool to add one.'
          : 'Pick a shape tool, then draw your first bed.';

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
  const fallOutside = nPending === 1 ? 'falls outside' : 'fall outside';
  const them = nPending === 1 ? 'it' : 'them';

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
          onDoubleClick={() => {
            if (tool === 'polygon') finishPolygon();
          }}
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
              // Each bed's plants are drawn with it, so a bed on top of another covers its plants too.
              <g key={bed.id}>
                <g transform={`translate(${b.cx} ${b.cy}) rotate(${b.rotationDeg})`}>
                  <BedShape
                    bed={b}
                    data-bed-id={bed.id}
                    onPointerDown={(e) => onBedDown(e, bed)}
                    onPointerEnter={() => setHoverId(bed.id)}
                    onPointerLeave={() => setHoverId((h) => (h === bed.id ? null : h))}
                    style={{
                      fill: C.bed,
                      stroke: isSel ? 'var(--color-accent)' : C.bedStroke,
                      strokeWidth: px(isSel ? 3.5 : 1.5),
                      strokeLinejoin: 'round',
                      cursor: tool === 'select' && !pending && !spaceHeld ? 'move' : undefined,
                    }}
                  />
                  {/* An ellipse or polygon doesn't fill its box, so show the box it resizes by. */}
                  {b.shape !== 'rect' && (isSel || bed.id === hoverId) && (
                    <rect
                      x={-b.widthIn / 2}
                      y={-b.heightIn / 2}
                      width={b.widthIn}
                      height={b.heightIn}
                      style={{
                        fill: 'none',
                        stroke: isSel ? 'var(--color-accent)' : C.faint,
                        strokeWidth: px(isSel ? 2 : 1),
                        strokeDasharray: `${px(6)} ${px(4)}`,
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </g>
                {plants.filter((p) => p.bedId === bed.id).map(plantDot)}
              </g>
            );
          })}

          {beds.map((bed) => {
            if (bed.id === editingNameId) return null;
            const at = labelAnchor(displayed(bed));
            return (
              <text
                key={`name-${bed.id}`}
                x={at.x}
                y={at.y - px(7)}
                textAnchor={at.align}
                data-bed-name={bed.id}
                // Stop the press here so it doesn't pan the canvas or deselect the bed.
                onPointerDown={(e) => nameEditable && e.button === 0 && e.stopPropagation()}
                onClick={(e) => onNameClick(e, bed)}
                style={{
                  font: `600 ${px(12)}px Figtree`,
                  fill: C.muted,
                  pointerEvents: nameEditable ? 'all' : 'none',
                  cursor: nameEditable ? 'text' : undefined,
                }}
              >
                {bed.name}
              </text>
            );
          })}


          {beds.flatMap((bed) => {
            const isSel = bed.id === selectedId;
            if (!isSel && bed.id !== hoverId) return [];
            return bedPills(bed.id, displayed(bed), isSel);
          })}

          {selected && !drawBox && !corners.length && (() => {
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
                    style={{ ...hit, cursor: resizeCursor(h, b.rotationDeg) }}
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
                    style={{ fill: 'transparent', cursor: resizeCursor(h, b.rotationDeg) }}
                  />
                ))}
                <line x1={0} y1={-hh} x2={0} y2={-hh - px(22)} style={{ stroke: 'var(--color-accent)', strokeWidth: px(2), pointerEvents: 'none' }} />
                <g
                  data-rotate-handle=""
                  transform={`translate(0 ${-hh - px(34)})`}
                  onPointerDown={(e) => onRotateDown(e, selected)}
                  style={{ cursor: drag?.kind === 'rotate' ? 'grabbing' : 'grab' }}
                >
                  <title>Drag to rotate</title>
                  <circle r={px(16)} style={{ fill: 'transparent' }} />
                  <circle r={px(8)} style={{ fill: 'var(--color-accent)', stroke: C.ground, strokeWidth: px(2) }} />
                  <path
                    d={`M${-px(10)} ${-px(7)}A${px(12.5)} ${px(12.5)} 0 0 1 ${px(10)} ${-px(7)}`}
                    style={{ fill: 'none', stroke: 'var(--color-accent)', strokeWidth: px(2.2), strokeLinecap: 'round' }}
                  />
                </g>
                {b.points?.map((q, i) => (
                  <circle
                    key={`v${i}`}
                    data-corner={i}
                    cx={q.x - hw}
                    cy={q.y - hh}
                    r={px(5.5)}
                    onPointerDown={(e) => onCornerDown(e, selected, i)}
                    style={{ fill: 'var(--color-accent)', stroke: C.ground, strokeWidth: px(2), cursor: 'move' }}
                  />
                ))}
              </g>
            );
          })()}

          {drag?.kind === 'draw' && (
            <g style={{ pointerEvents: 'none' }}>
              {/* Until the drag has both a width and a height there's no box yet: show the line itself. */}
              {drawBox && (drawBox.width === 0 || drawBox.height === 0) && (
                <>
                  <line
                    x1={drag.a.x}
                    y1={drag.a.y}
                    x2={drag.b.x}
                    y2={drag.b.y}
                    style={{ stroke: 'var(--color-accent)', strokeWidth: px(2), strokeDasharray: `${px(6)} ${px(4)}` }}
                  />
                  {edgePills('draw', [drag.a, drag.b], false, true)}
                </>
              )}
              <circle cx={drag.a.x} cy={drag.a.y} r={px(4.5)} style={{ fill: 'var(--color-accent)' }} />
            </g>
          )}
          {(drag?.kind === 'move' || drag?.kind === 'resize') &&
            drag.guides.map((g) => (
              // Where the edit has snapped to: another bed's edge or center, or a foot mark.
              <line
                key={`${g.axis}${g.at}`}
                data-guide={g.axis}
                x1={g.axis === 'x' ? g.at : view.x}
                x2={g.axis === 'x' ? g.at : view.x + size.w / zoom}
                y1={g.axis === 'y' ? g.at : view.y}
                y2={g.axis === 'y' ? g.at : view.y + size.h / zoom}
                style={{ stroke: 'var(--color-accent)', strokeWidth: px(1.5), strokeDasharray: `${px(5)} ${px(4)}`, pointerEvents: 'none' }}
              />
            ))}
          {drag?.kind === 'rotate' && selected && pill('angle', { x: selected.cx, y: selected.cy }, `${drag.rotationDeg}°`, true, drag.rotationDeg % 45 === 0)}

          {drawBox && tool === 'ellipse' && (
            <>
              <rect
                x={drawBox.x}
                y={drawBox.y}
                width={drawBox.width}
                height={drawBox.height}
                style={{ fill: 'none', stroke: 'var(--color-accent)', strokeOpacity: 0.5, strokeWidth: px(1), strokeDasharray: `${px(6)} ${px(4)}`, pointerEvents: 'none' }}
              />
              <ellipse
                cx={drawBox.x + drawBox.width / 2}
                cy={drawBox.y + drawBox.height / 2}
                rx={drawBox.width / 2}
                ry={drawBox.height / 2}
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
            </>
          )}
          {drawBox && tool !== 'ellipse' && (
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
          {corners.length > 0 && (() => {
            const chain = cursor && !pending ? [...corners, cursor] : corners;
            const closing = !!cursor && closesPolygon(corners, cursor, zoom);
            return (
              <g style={{ pointerEvents: 'none' }}>
                <polyline
                  points={chain.map((q) => `${q.x},${q.y}`).join(' ')}
                  style={{ fill: C.draft, fillOpacity: 0.6, stroke: 'var(--color-accent)', strokeWidth: px(2), strokeLinejoin: 'round' }}
                />
                {edgePills('poly', chain, false, true)}
                {corners.map((q, i) => (
                  <circle
                    key={i}
                    cx={q.x}
                    cy={q.y}
                    r={px(i === 0 ? 7 : 4.5)}
                    style={{ fill: i === 0 && closing ? 'var(--color-accent)' : C.ground, stroke: 'var(--color-accent)', strokeWidth: px(2.5) }}
                  />
                ))}
              </g>
            );
          })()}
          {drawBox && draft && dimensionPills('draft', draft, true)}

          {tool !== 'select' && cursor && !pending && (
            <circle cx={cursor.x} cy={cursor.y} r={px(3.5)} style={{ fill: 'var(--color-accent)', pointerEvents: 'none' }} />
          )}
        </svg>
      )}

      {view &&
        (() => {
          const bed = beds.find((b) => b.id === editingNameId);
          if (!bed) return null;
          const anchor = labelAnchor(displayed(bed));
          const at = gardenToScreen(view, anchor);
          const centered = anchor.align === 'middle';
          return (
            <BedNameInput
              key={bed.id}
              name={bed.name}
              left={centered ? at.x : at.x - 6}
              centered={centered}
              bottom={at.y - 2}
              onDone={(name) => finishNameEdit(bed, name)}
            />
          );
        })()}

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
        <ToolButton icon="ellipse" title="Ellipse bed (E)" active={tool === 'ellipse'} onClick={() => pickTool('ellipse')} />
        <ToolButton icon="polygon" title="Polygon bed (P)" active={tool === 'polygon'} onClick={() => pickTool('polygon')} />
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
            onRadius={(r) => setRadiusFromPanel(selected, r)}
            onRotate={(deg) => setRotation(selected, deg)}
            onDelete={() => requestDelete(selected)}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px 14px', background: 'var(--color-bg)', font: '700 19px Figtree' }}>Beds</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 16 }}>
              {beds.length === 0 && (
                <p style={{ font: '400 13px Figtree', color: C.muted }}>No beds yet. Draw one with a shape tool.</p>
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
              ? pending.change === 'corner'
                ? `With that corner moved, ${plantWord} (${plantSummary(pendingPlants)}) ${fallOutside} ${pendingBed.name}. Reshaping removes ${them} from the plan.`
                : pending.change === 'radius'
                  ? `With corners rounded to ${formatLength(drawnCornerRadius(pending.draft))}, ${plantWord} (${plantSummary(pendingPlants)}) ${fallOutside} ${pendingBed.name}. Rounding them removes ${them} from the plan.`
                  : `At ${formatLength(pending.draft.widthIn)} × ${formatLength(pending.draft.heightIn)}, ${plantWord} (${plantSummary(pendingPlants)}) ${fallOutside} ${pendingBed.name}. Resizing removes ${them} from the plan.`
              : `Its ${plantWord} (${plantSummary(pendingPlants)}) will be removed from the plan too.`}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button className="btn btn-secondary" onClick={() => setPending(null)}>
              Keep plants
            </button>
            <button className="btn btn-primary" onClick={confirmPending}>
              {pending.kind === 'resize' ? RESIZE_CONFIRM_LABEL[pending.change] : 'Delete bed'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A bed's outline, drawn centered on the origin (the caller translates and rotates it into place). */
function BedShape({ bed, ...rest }: { bed: Bed } & React.SVGProps<SVGRectElement & SVGEllipseElement & SVGPolygonElement>) {
  const hw = bed.widthIn / 2;
  const hh = bed.heightIn / 2;
  if (bed.shape === 'ellipse') return <ellipse cx={0} cy={0} rx={hw} ry={hh} {...rest} />;
  if (bed.shape === 'polygon' && bed.points) {
    return <polygon points={bed.points.map((q) => `${q.x - hw},${q.y - hh}`).join(' ')} {...rest} />;
  }
  return <rect x={-hw} y={-hh} width={bed.widthIn} height={bed.heightIn} rx={drawnCornerRadius(bed)} {...rest} />;
}

/** The in-place editor for a bed's name, sitting just above the name's spot on the canvas. */
function BedNameInput({
  name,
  left,
  centered,
  bottom,
  onDone,
}: {
  name: string;
  left: number;
  /** Whether `left` is the input's middle rather than its left edge. */
  centered: boolean;
  bottom: number;
  /** The typed name, or null if editing was cancelled. */
  onDone: (name: string | null) => void;
}) {
  const [text, setText] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      aria-label="Bed name"
      data-testid="bed-name-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(cancelled.current ? null : text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      style={{
        position: 'absolute',
        left,
        transform: centered ? 'translateX(-50%)' : undefined,
        // Anchored by its bottom edge so it sits where the name's text does at any zoom.
        bottom: `calc(100% - ${bottom}px)`,
        width: 180,
        height: 26,
        padding: '0 6px',
        font: '600 12px Figtree',
        color: 'var(--color-text)',
        background: 'var(--color-surface)',
        border: '1.5px solid var(--color-accent)',
        borderRadius: 8,
        outline: 'none',
      }}
    />
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
  onRadius,
  onRotate,
  onDelete,
}: {
  bed: Bed;
  plantCount: number;
  onBack: () => void;
  onRename: (name: string) => void;
  onSize: (widthIn: number, heightIn: number) => void;
  onRadius: (inches: number) => void;
  onRotate: (deg: number) => void;
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
          <StepperRow
            label="Width"
            display={formatLength(bed.widthIn)}
            parse={parseLength}
            onCommit={(v) => onSize(v, bed.heightIn)}
            down={{ icon: 'minus', title: 'Shrink width', onClick: () => onSize(bed.widthIn - LAYOUT_SNAP_IN, bed.heightIn) }}
            up={{ icon: 'plus', title: 'Grow width', onClick: () => onSize(bed.widthIn + LAYOUT_SNAP_IN, bed.heightIn) }}
          />
          <StepperRow
            label="Length"
            display={formatLength(bed.heightIn)}
            parse={parseLength}
            onCommit={(v) => onSize(bed.widthIn, v)}
            down={{ icon: 'minus', title: 'Shrink length', onClick: () => onSize(bed.widthIn, bed.heightIn - LAYOUT_SNAP_IN) }}
            up={{ icon: 'plus', title: 'Grow length', onClick: () => onSize(bed.widthIn, bed.heightIn + LAYOUT_SNAP_IN) }}
          />
          {bed.shape === 'rect' && (
            <StepperRow
              label="Corners"
              display={formatLength(drawnCornerRadius(bed))}
              parse={(t) => parseLength(t, { bareUnit: 'in', allowZero: true })}
              onCommit={onRadius}
              down={{ icon: 'minus', title: 'Square the corners more', onClick: () => onRadius(drawnCornerRadius(bed) - 1) }}
              up={{ icon: 'plus', title: 'Round the corners more', onClick: () => onRadius(drawnCornerRadius(bed) + 1) }}
            />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ font: '700 11px Figtree', letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
            Rotation
          </span>
          <StepperRow
            label="Angle"
            display={`${bed.rotationDeg}°`}
            parse={parseAngle}
            onCommit={onRotate}
            down={{ icon: 'ccw', title: `Rotate left ${ROTATION_STEP_DEG}°`, onClick: () => onRotate(stepAngle(bed.rotationDeg, -1)) }}
            up={{ icon: 'cw', title: `Rotate right ${ROTATION_STEP_DEG}°`, onClick: () => onRotate(stepAngle(bed.rotationDeg, 1)) }}
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

/**
 * A labelled value with step buttons either side and a field to type it in: `display` shows
 * while the field isn't being edited; on Enter or leaving the field, `parse` reads what was
 * typed and `onCommit` gets it (nothing happens if it doesn't parse). Esc cancels the edit.
 */
function StepperRow({
  label,
  display,
  parse,
  onCommit,
  down,
  up,
}: {
  label: string;
  display: string;
  parse: (text: string) => number | null;
  onCommit: (value: number) => void;
  down: { icon: IconName; title: string; onClick: () => void };
  up: { icon: IconName; title: string; onClick: () => void };
}) {
  /** What's typed while the field has focus; null when it just shows `display`. */
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const stepBtn = { width: 32, height: 32, padding: 0, justifyContent: 'center', borderRadius: 999 } as const;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, font: '400 14px Figtree' }}>{label}</span>
      <button className="btn btn-secondary" title={down.title} aria-label={down.title} onClick={down.onClick} style={stepBtn}>
        <Icon name={down.icon} size={15} />
      </button>
      <input
        aria-label={label}
        value={text ?? display}
        onFocus={(e) => {
          cancelled.current = false;
          setText(display);
          const el = e.target;
          setTimeout(() => el.select(), 0);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = text === null || cancelled.current ? null : parse(text);
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
      <button className="btn btn-secondary" title={up.title} aria-label={up.title} onClick={up.onClick} style={stepBtn}>
        <Icon name={up.icon} size={15} />
      </button>
    </div>
  );
}
