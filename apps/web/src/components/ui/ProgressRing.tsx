/**
 * ProgressRing — SVG circular progress indicator. value 0-100.
 */
import { HTMLAttributes } from 'react';

export interface ProgressRingProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  showLabel?: boolean;
}

const toneColor: Record<NonNullable<ProgressRingProps['tone']>, string> = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger:  'var(--color-danger)',
};

export default function ProgressRing({
  value, size = 64, strokeWidth = 6, tone = 'primary', showLabel = true,
  className = '', style, ...rest
}: ProgressRingProps) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (v / 100) * circumference;
  const color = toneColor[tone];
  return (
    <div
      className={className}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        position: 'relative', width: size, height: size,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        ...style,
      }}
      {...rest}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="var(--color-neutral-200)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          style={{ transition: 'stroke-dasharray .3s ease' }}
        />
      </svg>
      {showLabel ? (
        <span style={{
          position: 'absolute', fontSize: Math.max(11, size / 5),
          fontWeight: 700, color: 'var(--color-neutral-900)',
        }}>
          {Math.round(v)}%
        </span>
      ) : null}
    </div>
  );
}
