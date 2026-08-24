/**
 * ConfirmDialog — modal dialog for confirmation flows.
 * Used directly and re-exported from shared business components.
 */
import { ReactNode, useEffect } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  ariaLabel?: string;
}

export default function ConfirmDialog({
  open, title, children,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  confirmTone = 'primary', onConfirm, onCancel, ariaLabel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const resolvedAriaLabel: string = ariaLabel ?? (typeof title === 'string' ? title : 'Confirm dialog');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={resolvedAriaLabel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(17,24,39,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-3)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: '100%', maxWidth: 440,
        background: '#fff', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--color-neutral-200)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: 'var(--space-3) var(--space-3) var(--space-2)',
          borderBottom: '1px solid var(--color-neutral-200)',
          fontSize: 16, fontWeight: 600, color: 'var(--color-neutral-900)',
        }}>
          {title}
        </div>
        <div style={{
          padding: 'var(--space-3)', fontSize: 14, color: 'var(--color-neutral-700)',
        }}>
          {children}
        </div>
        <div style={{
          padding: 'var(--space-2) var(--space-3) var(--space-3)',
          borderTop: '1px solid var(--color-neutral-200)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius-md)',
              background: '#fff', color: 'var(--color-neutral-700)',
              border: '1px solid var(--color-neutral-200)', fontWeight: 600,
              cursor: 'pointer', fontSize: 14,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius-md)',
              background: confirmTone === 'danger' ? 'var(--color-danger)' : 'var(--color-primary)',
              color: '#fff',
              border: `1px solid ${confirmTone === 'danger' ? 'var(--color-danger)' : 'var(--color-primary)'}`,
              fontWeight: 600, cursor: 'pointer', fontSize: 14,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
