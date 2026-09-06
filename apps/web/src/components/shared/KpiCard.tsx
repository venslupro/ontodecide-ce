/**
 * KpiCard — metric tile with label, value, delta, sparkline SVG and an icon tile.
 * The icon tile accepts either a React node (`iconNode`, preferred for inline
 * SVGs) or an external image URL (`iconImage`).
 */
import { HTMLAttributes, ReactNode } from 'react';

export type DeltaTone = 'positive' | 'negative' | 'neutral';

export interface KpiCardProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  delta?: { value: ReactNode; tone?: DeltaTone; label?: ReactNode };
  sparkline?: number[];       /** Numeric series; normalized to 64x24 SVG. */
  iconNode?: ReactNode;       /** Inline icon (preferred over iconImage). */
  iconImage?: string;         /** External image URL for the icon tile. */
  iconAlt?: string;
  iconTileBg?: string;
}

/** Default icon — a generic bar-chart glyph rendered as inline SVG. */
function DefaultKpiIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="13" width="4" height="7" rx="1" fill="var(--color-primary)" />
      <rect x="10" y="9" width="4" height="11" rx="1" fill="var(--color-primary)" />
      <rect x="16" y="5" width="4" height="15" rx="1" fill="var(--color-primary)" />
    </svg>
  );
}

export default function KpiCard({
  label, value, delta, sparkline,
  iconNode,
  iconImage,
  iconAlt = 'KPI icon',
  iconTileBg = 'var(--color-primary-50)',
  className = '', style, ...rest
}: KpiCardProps) {
  const delColor =
    delta?.tone === 'positive' ? 'var(--color-success)' :
    delta?.tone === 'negative' ? 'var(--color-danger)' :
    'var(--color-neutral-500)';
  return (
    <div
      className={className}
      style={{
        background: '#fff', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-neutral-200)',
        boxShadow: 'var(--shadow-sm)',
        padding: 'var(--space-3)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        minWidth: 0, ...style,
      }}
      {...rest}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 'var(--space-2)',
      }}>
        <div style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>{label}</div>
        <div style={{
          width: 36, height: 36, borderRadius: 'var(--radius-md)',
          background: iconTileBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {iconNode ? iconNode : iconImage ? (
            <img
              src={iconImage}
              alt={iconAlt}
              style={{ width: 22, height: 22, objectFit: 'contain' }}
            />
          ) : <DefaultKpiIcon />}
        </div>
      </div>
      <div style={{
        fontSize: 28, fontWeight: 700, color: 'var(--color-neutral-900)',
        lineHeight: 1.1, letterSpacing: '-0.01em',
      }}>
        {value}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {delta ? (
          <span style={{ fontSize: 12, color: delColor, fontWeight: 600 }}>
            {delta.tone === 'positive' ? '▲' : delta.tone === 'negative' ? '▼' : '■'} {delta.value}
            {delta.label ? (
              <span style={{ color: 'var(--color-neutral-500)', fontWeight: 400, marginLeft: 6 }}>
                {delta.label}
              </span>
            ) : null}
          </span>
        ) : <span />}
        {sparkline && sparkline.length > 1 ? (
          <Sparkline values={sparkline} />
        ) : null}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 64; const h = 24; const pad = 2;
  const min = Math.min(...values); const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const d = values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (h - pad * 2) * (1 - (v - min) / range);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true" style={{ display: 'block' }}>
      <path
        d={d}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
