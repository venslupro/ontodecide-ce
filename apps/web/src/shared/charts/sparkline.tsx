/**
 * @fileoverview Dependency-free SVG sparkline (keeps KPI cards cheap).
 */

import {useId} from 'react';

/** Small trend line with area gradient. */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  color = 'var(--cyan)',
  label,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const pts = values.filter(v => Number.isFinite(v));
  if (pts.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        aria-hidden={!label}
        role={label ? 'img' : undefined}
        aria-label={label}
      />
    );
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const xy = pts.map(
    (v, i) =>
      [i * step, height - 2 - ((v - min) / span) * (height - 4)] as const,
  );
  const line = xy
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={!label}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
