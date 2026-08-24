/**
 * DataSourceIcon — tiny inline SVG icon representing a source format:
 * csv / json / parquet / webhook. Zero runtime deps.
 */
import { HTMLAttributes } from 'react';

export type DataSourceKind = 'csv' | 'json' | 'parquet' | 'webhook';

export interface DataSourceIconProps extends HTMLAttributes<HTMLSpanElement> {
  kind: DataSourceKind;
  size?: number;
  ariaLabel?: string;
}

const kindMeta: Record<DataSourceKind, { bg: string; fg: string; label: string }> = {
  csv:     { bg: '#E8F5EC', fg: 'var(--color-success)', label: 'CSV' },
  json:    { bg: 'var(--color-accent-50)', fg: 'var(--color-accent)', label: 'JSON' },
  parquet: { bg: 'var(--color-primary-50)', fg: 'var(--color-primary)', label: 'PQ' },
  webhook: { bg: '#FBF3DC', fg: 'var(--color-warning)', label: 'WH' },
};

export default function DataSourceIcon({
  kind, size = 16, ariaLabel, className = '', style, ...rest
}: DataSourceIconProps) {
  const m = kindMeta[kind];
  return (
    <span
      className={className}
      role="img"
      aria-label={ariaLabel ?? `${m.label} data source`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: 'var(--radius-sm)',
        background: m.bg, color: m.fg,
        fontSize: Math.max(9, Math.round(size / 2.2)),
        fontWeight: 700, fontFamily: 'monospace',
        letterSpacing: '-0.02em', ...style,
      }}
      {...rest}
    >
      {renderSvg(kind, size, m.fg)}
    </span>
  );
}

function renderSvg(kind: DataSourceKind, s: number, stroke: string) {
  // Compact text-free glyphs
  if (kind === 'csv') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke={stroke} strokeWidth="1.5"/>
        <path d="M7 9h10M7 13h10M7 17h6" stroke={stroke} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }
  if (kind === 'json') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4c-2 2-2 4 0 6-2 2-2 4 0 6" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M16 4c2 2 2 4 0 6 2 2 2 4 0 6" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }
  if (kind === 'parquet') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke={stroke} strokeWidth="1.5"/>
        <path d="M7 7h4v4H7zM13 7h4v4h-4zM7 13h4v4H7zM13 13h4v4h-4z" fill="none" stroke={stroke} strokeWidth="1.2"/>
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 0 8h-1" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M20 16a4 4 0 0 1-4 4H8a4 4 0 0 1 0-8h1" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
