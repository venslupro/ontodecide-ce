/**
 * @fileoverview Segmented control (e.g. the 中文 | EN switch): a radio
 * group styled as joined buttons.
 */

import {cn} from '../lib/cn';

/** One option. */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Accessible name when the label is an abbreviation. */
  ariaLabel?: string;
}

/** Segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  className,
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange(value: T): void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex overflow-hidden rounded-[var(--radius-btn)] border border-line-2 bg-panel-2',
        className,
      )}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            onClick={() => !on && onChange(o.value)}
            className={cn(
              'whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-sm',
              on
                ? 'bg-cyan/15 font-medium text-text shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--cyan)_45%,transparent)]'
                : 'text-muted hover:text-text',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
