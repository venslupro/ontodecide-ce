/**
 * @fileoverview Step indicator for wizards; completed steps show a check
 * and can be revisited.
 */

import {Check} from 'lucide-react';
import {cn} from '../lib/cn';

/** Horizontal stepper. */
export function Stepper({
  steps,
  current,
  completed,
  onSelect,
  label,
}: {
  steps: string[];
  current: number;
  completed: ReadonlySet<number>;
  onSelect?: (index: number) => void;
  label?: string;
}) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => {
        const done = completed.has(i);
        const active = i === current;
        const clickable = !!onSelect && (done || i < current);
        return (
          <li key={s} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onSelect?.(i)}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                active && 'border-cyan bg-cyan/15 text-cyan',
                !active && done && 'border-good/50 text-good hover:bg-good/10',
                !active && !done && 'border-line-2 text-dim',
                clickable ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border text-[11px]',
                  active
                    ? 'border-cyan'
                    : done
                      ? 'border-good bg-good/15'
                      : 'border-line-2',
                )}
              >
                {done && !active ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              {s}
            </button>
            {i < steps.length - 1 && (
              <span aria-hidden className="h-px w-6 bg-line-2" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
