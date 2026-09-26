/**
 * @fileoverview Reads design tokens (CSS variables) for charts so both
 * themes share one source of truth.
 */

import {useEffect, useState} from 'react';

/** Chart-relevant token values. */
export interface ChartTokens {
  text: string;
  muted: string;
  dim: string;
  line: string;
  line2: string;
  grid: string;
  panel: string;
  cyan: string;
  blue: string;
  violet: string;
  orange: string;
  good: string;
  warn: string;
  crit: string;
  fontFamily: string;
}

const FALLBACK: ChartTokens = {
  text: '#E6ECFF',
  muted: '#8B98BA',
  dim: '#7A88AD',
  line: 'rgba(110,150,255,.16)',
  line2: 'rgba(110,150,255,.28)',
  grid: 'rgba(139,152,186,.09)',
  panel: '#111B33',
  cyan: '#22D3EE',
  blue: '#3B82F6',
  violet: '#8B5CF6',
  orange: '#FB923C',
  good: '#22C55E',
  warn: '#F59E0B',
  crit: '#EF4444',
  fontFamily: 'Inter, "Noto Sans SC", sans-serif',
};

/** Reads the current token values from `:root`. */
export function readChartTokens(): ChartTokens {
  if (
    typeof document === 'undefined' ||
    typeof getComputedStyle === 'undefined'
  )
    return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) =>
    cs.getPropertyValue(name).trim() || fb;
  return {
    text: v('--text', FALLBACK.text),
    muted: v('--muted', FALLBACK.muted),
    dim: v('--dim', FALLBACK.dim),
    line: v('--line', FALLBACK.line),
    line2: v('--line-2', FALLBACK.line2),
    grid: v('--chart-grid', FALLBACK.grid),
    panel: v('--panel-solid', FALLBACK.panel),
    cyan: v('--cyan', FALLBACK.cyan),
    blue: v('--blue', FALLBACK.blue),
    violet: v('--violet', FALLBACK.violet),
    orange: v('--orange', FALLBACK.orange),
    good: v('--good', FALLBACK.good),
    warn: v('--warn', FALLBACK.warn),
    crit: v('--crit', FALLBACK.crit),
    fontFamily: FALLBACK.fontFamily,
  };
}

/** Data series colors 1–3 (status colors are never used as series). */
export function seriesColors(t: ChartTokens): string[] {
  return [t.cyan, t.blue, t.violet, t.orange];
}

/** Re-reads tokens whenever `data-theme` changes on `<html>`. */
export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState(readChartTokens);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const obs = new MutationObserver(() => setTokens(readChartTokens()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => obs.disconnect();
  }, []);
  return tokens;
}

/**
 * Orange single-hue scale for impact heat (0..1 → light to strong).
 * Returns an rgba string based on the orange token.
 */
export function impactColor(
  intensity: number,
  orange = FALLBACK.orange,
): string {
  const k = Math.max(0, Math.min(1, intensity));
  const hex = orange.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map(c => c + c)
          .join('')
      : hex.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) || 251;
  const g = parseInt(full.slice(2, 4), 16) || 146;
  const b = parseInt(full.slice(4, 6), 16) || 60;
  return `rgba(${r},${g},${b},${(0.18 + 0.82 * k).toFixed(3)})`;
}
