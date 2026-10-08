/**
 * @fileoverview Reads design tokens (CSS variables) for charts. The theme is
 * a single light palette, so tokens are read once at first use.
 */

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
  text: '#0f1a33',
  muted: '#4a5878',
  dim: '#5d6a88',
  line: 'rgba(37,64,140,.14)',
  line2: 'rgba(37,64,140,.26)',
  grid: 'rgba(74,88,120,.12)',
  panel: '#ffffff',
  cyan: '#0e7490',
  blue: '#2563eb',
  violet: '#7c3aed',
  orange: '#c2410c',
  good: '#15803d',
  warn: '#92400e',
  crit: '#dc2626',
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

let cachedTokens: ChartTokens | null = null;

/** Returns the (constant) chart tokens (memoized; stable reference). */
export function useChartTokens(): ChartTokens {
  if (!cachedTokens) cachedTokens = readChartTokens();
  return cachedTokens;
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
  const r = parseInt(full.slice(0, 2), 16) || 194;
  const g = parseInt(full.slice(2, 4), 16) || 65;
  const b = parseInt(full.slice(4, 6), 16) || 12;
  return `rgba(${r},${g},${b},${(0.18 + 0.82 * k).toFixed(3)})`;
}
