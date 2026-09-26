/**
 * @fileoverview Progress and quota bars.
 */

import {cn} from '../lib/cn';

/** Horizontal progress bar (0..1). */
export function Progress({
  value,
  className,
  tone = 'accent',
  label,
  marker,
}: {
  value: number;
  className?: string;
  tone?: 'accent' | 'good' | 'warn' | 'crit' | 'orange';
  label?: string;
  /** Optional marker line position (0..1), e.g. the 80% warning line. */
  marker?: number;
}) {
  const pct =
    Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  const fill = {
    accent: 'bg-[linear-gradient(90deg,var(--cyan),var(--blue))]',
    good: 'bg-good',
    warn: 'bg-warn',
    crit: 'bg-crit',
    orange: 'bg-orange',
  }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-line-2',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300 ease-out',
          fill,
        )}
        style={{width: `${pct}%`}}
      />
      {marker !== undefined && (
        <div
          aria-hidden
          className="absolute top-0 h-full w-px bg-text/70"
          style={{left: `${marker * 100}%`}}
        />
      )}
    </div>
  );
}

/** Tone for a usage ratio: ≥ 95% crit, ≥ 80% warn. */
export function usageTone(ratio: number): 'good' | 'warn' | 'crit' {
  if (ratio >= 0.95) return 'crit';
  if (ratio >= 0.8) return 'warn';
  return 'good';
}
