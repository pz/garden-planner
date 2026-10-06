import { useRef, useState } from 'react';
import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { PlantMark, CROP_COLORS } from './PlantMark';
import { isContextPress, isReleasedMove } from '../utils/pointer';

export const LONG_PRESS_MS = 450;
export const MOVE_THRESHOLD_PX = 6;

/** 'copy' (a plus badge) for a patch drag, since it adds plants rather than moving one. */
const GESTURE_CURSORS = { idle: 'grab', move: 'grabbing', armed: 'copy', multiply: 'copy' } as const;

export interface GestureHandlers {
  onSelect: (id: string) => void;
  onQuickActions: (id: string, clientX: number, clientY: number) => void;
  onMoveStart: (id: string) => void;
  onMoveUpdate: (id: string, clientX: number, clientY: number) => void;
  onMoveEnd: (id: string, committed: boolean) => void;
  onMultiplyStart: (id: string) => void;
  onMultiplyUpdate: (id: string, clientX: number, clientY: number) => void;
  onMultiplyEnd: (id: string, committed: boolean) => void;
}

export function PlantToken({
  plant,
  pxPerInch,
  diameter,
  warned,
  selected,
  handlers,
  counterRotateDeg = 0,
}: {
  plant: PlantInstance;
  pxPerInch: number;
  diameter: number;
  warned: boolean;
  selected: boolean;
  handlers: GestureHandlers;
  /** The bed's turn: the token is placed in the turned bed but drawn upright. */
  counterRotateDeg?: number;
}) {
  const crop = getCrop(plant.cropId);
  const color = CROP_COLORS[plant.cropId] ?? 'var(--color-accent)';
  // Drives the cursor: 'armed' once a long-press has elapsed (the next drag will multiply
  // into a patch rather than move), so the user can see which gesture they're about to make.
  const [gesture, setGesture] = useState<'idle' | 'armed' | 'move' | 'multiply'>('idle');

  const stateRef = useRef<{
    startX: number;
    startY: number;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    isLongPress: boolean;
    mode: 'none' | 'move' | 'multiply';
    pointerId: number;
  } | null>(null);

  function clearTimer() {
    const st = stateRef.current;
    if (st?.longPressTimer) {
      clearTimeout(st.longPressTimer);
      st.longPressTimer = null;
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    if (isContextPress(e)) return; // right-click / macOS Ctrl-click: no gesture, and no capture to strand
    (e.target as Element).setPointerCapture(e.pointerId);
    const st = {
      startX: e.clientX,
      startY: e.clientY,
      longPressTimer: null as ReturnType<typeof setTimeout> | null,
      isLongPress: false,
      mode: 'none' as 'none' | 'move' | 'multiply',
      pointerId: e.pointerId,
    };
    stateRef.current = st;
    st.longPressTimer = setTimeout(() => {
      st.isLongPress = true;
      if (st.mode === 'none') setGesture('armed');
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const st = stateRef.current;
    if (!st) return;
    // The button came up unseen (a context menu swallowed the pointerup): end, don't start a drag.
    if (isReleasedMove(e)) return cancelGesture(e);
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < MOVE_THRESHOLD_PX) return;

    if (st.mode === 'none') {
      if (st.isLongPress) {
        st.mode = 'multiply';
        handlers.onMultiplyStart(plant.id);
      } else {
        clearTimer();
        st.mode = 'move';
        handlers.onMoveStart(plant.id);
      }
      setGesture(st.mode);
    }
    if (st.mode === 'move') handlers.onMoveUpdate(plant.id, e.clientX, e.clientY);
    if (st.mode === 'multiply') handlers.onMultiplyUpdate(plant.id, e.clientX, e.clientY);
  }

  function cancelGesture(e: React.PointerEvent) {
    const st = stateRef.current;
    clearTimer();
    setGesture('idle');
    stateRef.current = null;
    if ((e.target as Element).hasPointerCapture?.(e.pointerId)) (e.target as Element).releasePointerCapture(e.pointerId);
    if (st?.mode === 'move') handlers.onMoveEnd(plant.id, false);
    else if (st?.mode === 'multiply') handlers.onMultiplyEnd(plant.id, false);
  }

  function handlePointerUp(e: React.PointerEvent) {
    const st = stateRef.current;
    clearTimer();
    setGesture('idle');
    if (!st) return;
    if (st.mode === 'move') {
      handlers.onMoveEnd(plant.id, true);
    } else if (st.mode === 'multiply') {
      handlers.onMultiplyEnd(plant.id, true);
    } else if (st.isLongPress) {
      handlers.onQuickActions(plant.id, e.clientX, e.clientY);
    } else {
      handlers.onSelect(plant.id);
    }
    stateRef.current = null;
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelGesture}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      title={plant.variety ? `${crop.name} — ${plant.variety}` : crop.name}
      style={{
        position: 'absolute',
        left: plant.x * pxPerInch,
        top: plant.y * pxPerInch,
        transform: counterRotateDeg ? `translate(-50%, -50%) rotate(${-counterRotateDeg}deg)` : 'translate(-50%, -50%)',
        cursor: GESTURE_CURSORS[gesture],
        touchAction: 'none',
        pointerEvents: 'auto', // beds that aren't rectangles let presses through their box
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: crop.spacingIn * pxPerInch,
          height: crop.spacingIn * pxPerInch,
          transform: 'translate(-50%, -50%)',
          borderRadius: '999px',
          border: `1.5px dashed ${color}`,
          background: `color-mix(in oklch, ${color} 10%, transparent)`,
          pointerEvents: 'none',
        }}
      />
      {selected && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: diameter + 12,
            height: diameter + 12,
            transform: 'translate(-50%, -50%)',
            borderRadius: '999px',
            border: '2.5px solid var(--color-accent)',
            boxShadow: '0 0 0 4px color-mix(in srgb, var(--color-accent) 22%, transparent)',
            pointerEvents: 'none',
          }}
        />
      )}
      <PlantMark family={crop.family} color={color} diameter={diameter} />
      {warned && (
        <div
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            width: 14,
            height: 14,
            borderRadius: '999px',
            background: 'var(--color-warning)',
            color: '#fffdf8',
            font: '700 9px Figtree',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid #fffdf8',
          }}
        >
          !
        </div>
      )}
    </div>
  );
}
