/**
 * Progress — linear progress bar. value 0-100.
 */
import { HTMLAttributes } from 'react';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;              /** 0..100 */
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  showLabel?: boolean;
  label?: string;
}

const toneColor: Record<NonNullable<ProgressProps['tone']>, string> = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger:  'var(--color-danger)',
};

export default function Progress({
  value, tone = 'primary', showLabel, label, className = '', style, ...rest
}: ProgressProps) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={className}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ width: '100%', ...style }}
      {...rest}
    >
      {(showLabel || label) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--color-neutral-700)',
          marginBottom: 4, fontWeight: 500,
        }}>
          <span>{label ?? 'Progress'}</span>
          <span>{Math.round(v)}%</span>
        </div>
      )}
      <div style={{
        width: '100%', height: 8,
        background: 'var(--color-neutral-100)',
        borderRadius: 999, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${v}%`,
          background: toneColor[tone],
          transition: 'width .3s ease',
        }} />
      </div>
    </div>
  );
}
