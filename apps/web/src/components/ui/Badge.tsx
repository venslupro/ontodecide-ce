/**
 * Badge — tiny status indicator pill (success/warning/danger/info/default).
 */
import { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone =
  | 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'default';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
}

const tones: Record<BadgeTone, { bg: string; color: string; border: string }> = {
  success: { bg: '#E8F5EC', color: 'var(--color-success)', border: '1px solid #C8E6D0' },
  warning: { bg: '#FBF3DC', color: 'var(--color-warning)', border: '1px solid #F1E1B0' },
  danger:  { bg: '#FBE8E7', color: 'var(--color-danger)',  border: '1px solid #F3C9C8' },
  info:    { bg: 'var(--color-accent-50)', color: 'var(--color-accent)', border: '1px solid #C7DEF9' },
  primary: { bg: 'var(--color-primary-50)', color: 'var(--color-primary)', border: '1px solid #D4C7FC' },
  default: { bg: 'var(--color-neutral-100)', color: 'var(--color-neutral-700)', border: '1px solid var(--color-neutral-200)' },
};

export default function Badge({
  tone = 'default', className = '', style, children, ...rest
}: BadgeProps) {
  const t = tones[tone];
  return (
    <span
      role="status"
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 10px', fontSize: 12, fontWeight: 600,
        borderRadius: 999, background: t.bg, color: t.color, border: t.border,
        whiteSpace: 'nowrap', lineHeight: 1.6, ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
