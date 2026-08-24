/**
 * Alert — inline informational banner. Tones: success/warning/danger/info.
 */
import { HTMLAttributes, ReactNode } from 'react';

export type AlertTone = 'success' | 'warning' | 'danger' | 'info';

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
}

const tones: Record<AlertTone, { bg: string; border: string; fg: string; icon: string }> = {
  success: { bg: '#E8F5EC', border: '#C8E6D0', fg: 'var(--color-success)', icon: '✓' },
  warning: { bg: '#FBF3DC', border: '#F1E1B0', fg: 'var(--color-warning)', icon: '!' },
  danger:  { bg: '#FBE8E7', border: '#F3C9C8', fg: 'var(--color-danger)',  icon: '✕' },
  info:    { bg: 'var(--color-accent-50)', border: '#C7DEF9', fg: 'var(--color-accent)', icon: 'i' },
};

export default function Alert({
  tone = 'info', title, children, className = '', style, onClose, ...rest
}: AlertProps) {
  const t = tones[tone];
  return (
    <div
      role="alert"
      className={className}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-md)', border: `1px solid ${t.border}`,
        background: t.bg, color: t.fg, fontSize: 14, ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          width: 20, height: 20, borderRadius: '50%',
          background: t.fg, color: t.bg, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1,
        }}
      >
        {t.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <strong style={{ display: 'block' }}>{title}</strong> : null}
        <div style={{ color: 'var(--color-neutral-700)' }}>{children}</div>
      </div>
      {onClose ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', color: 'inherit',
            cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0,
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
