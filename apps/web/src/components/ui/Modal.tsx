/**
 * Modal — generic dialog container with header/body/footer slots.
 */
import { HTMLAttributes, ReactNode, useEffect } from 'react';

export interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
  ariaLabel?: string;
}

export default function Modal({
  open, title, onClose, footer, width = 560,
  ariaLabel, className = '', style, children, ...rest
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : 'Dialog')}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(17,24,39,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-3)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={className}
        style={{
          width: '100%', maxWidth: width,
          background: '#fff', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--color-neutral-200)',
          display: 'flex', flexDirection: 'column', maxHeight: '86vh',
          ...style,
        }}
        {...rest}
      >
        {title ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 'var(--space-3) var(--space-3) var(--space-2)',
            borderBottom: '1px solid var(--color-neutral-200)',
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 20, lineHeight: 1, color: 'var(--color-neutral-500)',
                padding: 4,
              }}
            >
              ×
            </button>
          </div>
        ) : null}
        <div style={{
          padding: 'var(--space-3)', overflow: 'auto', flex: 1, minHeight: 0,
        }}>
          {children}
        </div>
        {footer ? (
          <div style={{
            padding: 'var(--space-2) var(--space-3) var(--space-3)',
            borderTop: '1px solid var(--color-neutral-200)',
            display: 'flex', justifyContent: 'flex-end', gap: 8,
          }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
