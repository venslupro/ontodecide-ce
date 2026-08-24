/**
 * Toast — lightweight singleton toast system.
 * Provides <ToastProvider/> + useToast() hook with success/error/info/warning.
 * No animation required.
 */
import {
  createContext, useCallback, useContext, useMemo, useState,
  ReactNode, useEffect,
} from 'react';

export type ToastTone = 'success' | 'warning' | 'danger' | 'info';
export interface ToastItem {
  id: string;
  tone: ToastTone;
  title?: string;
  message: string;
}
export interface ToastApi {
  show: (t: Omit<ToastItem, 'id'> & { timeoutMs?: number }) => string;
  remove: (id: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const toneStyle: Record<ToastTone, { bg: string; border: string; fg: string; icon: string }> = {
  success: { bg: '#E8F5EC', border: '#C8E6D0', fg: 'var(--color-success)', icon: '✓' },
  warning: { bg: '#FBF3DC', border: '#F1E1B0', fg: 'var(--color-warning)', icon: '!' },
  danger:  { bg: '#FBE8E7', border: '#F3C9C8', fg: 'var(--color-danger)',  icon: '✕' },
  info:    { bg: 'var(--color-accent-50)', border: '#C7DEF9', fg: 'var(--color-accent)', icon: 'i' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: string) => {
    setItems((list) => list.filter((x) => x.id !== id));
  }, []);
  const show = useCallback<ToastApi['show']>(
    ({ timeoutMs = 3500, ...t }) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setItems((list) => [...list, { id, ...t }]);
      if (timeoutMs > 0) {
        window.setTimeout(() => {
          setItems((list) => list.filter((x) => x.id !== id));
        }, timeoutMs);
      }
      return id;
    },
    [],
  );
  const api = useMemo<ToastApi>(() => ({ show, remove }), [show, remove]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-label="Toast notifications"
        style={{
          position: 'fixed', bottom: 24, right: 24, display: 'flex',
          flexDirection: 'column', gap: 8, zIndex: 9999, width: 340,
          pointerEvents: 'none',
        }}
      >
        {items.map((t) => {
          const s = toneStyle[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              style={{
                display: 'flex', gap: 10, padding: '12px 14px',
                background: s.bg, border: `1px solid ${s.border}`,
                color: 'var(--color-neutral-900)', borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-md)', pointerEvents: 'auto',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 20, height: 20, borderRadius: '50%', background: s.fg,
                  color: s.bg, display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 12, fontWeight: 700,
                  flexShrink: 0, marginTop: 1,
                }}
              >
                {s.icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {t.title ? <strong style={{ fontSize: 13 }}>{t.title}</strong> : null}
                <div style={{ fontSize: 13, marginTop: 2 }}>{t.message}</div>
              </div>
              <button
                type="button"
                aria-label="Dismiss toast"
                onClick={() => remove(t.id)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--color-neutral-500)', padding: 0, fontSize: 16,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/** Hook for consuming the toast API; warn outside provider and return no-op. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  useEffect(() => {
    if (!ctx && typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[useToast] used outside of <ToastProvider/>; toasts will be no-ops.');
    }
  }, [ctx]);
  return (
    ctx ?? {
      show: () => '',
      remove: () => undefined,
    }
  );
}

export default { Provider: ToastProvider, useToast };
