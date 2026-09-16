import { useEffect, useState } from 'react';

export interface ToastItem {
  id: string;
  message: string;
  onUndo?: () => void;
}

const AUTO_DISMISS_MS = 5000;
const EXIT_MS = 200;

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 8,
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [phase, setPhase] = useState<'enter' | 'idle' | 'leave'>('enter');

  useEffect(() => {
    const entered = requestAnimationFrame(() => setPhase('idle'));
    const autoTimer = setTimeout(() => setPhase('leave'), AUTO_DISMISS_MS);
    return () => {
      cancelAnimationFrame(entered);
      clearTimeout(autoTimer);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'leave') return;
    const timer = setTimeout(() => onDismiss(toast.id), EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase, toast.id, onDismiss]);

  return (
    <div
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 220,
        background: 'var(--color-text)',
        color: '#fffdf8',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        padding: '10px 10px 10px 14px',
        font: '500 13px Figtree',
        transform: phase === 'idle' ? 'translateY(0)' : 'translateY(14px)',
        opacity: phase === 'idle' ? 1 : 0,
        transition: `transform ${EXIT_MS}ms ease, opacity ${EXIT_MS}ms ease`,
      }}
    >
      <span style={{ flex: 1 }}>{toast.message}</span>
      {toast.onUndo && (
        <button
          onClick={() => {
            toast.onUndo?.();
            setPhase('leave');
          }}
          style={{ border: 'none', background: 'none', color: 'var(--color-accent)', font: '700 12.5px Figtree', padding: '4px 6px' }}
        >
          Undo
        </button>
      )}
      <button
        onClick={() => setPhase('leave')}
        aria-label="Dismiss"
        style={{ border: 'none', background: 'none', color: '#c8c0b3', font: '400 14px Figtree', padding: '4px 6px' }}
      >
        ✕
      </button>
    </div>
  );
}
