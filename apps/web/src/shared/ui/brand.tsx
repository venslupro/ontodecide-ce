/**
 * @fileoverview OntoDecide logo mark and wordmark.
 */

import {cn} from '../lib/cn';

/** Gradient logo mark (cyan → violet rounded square). */
export function LogoMark({className}: {className?: string}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,var(--cyan),var(--blue)_50%,var(--violet))] shadow-[0_0_18px_color-mix(in_srgb,var(--cyan)_40%,transparent)]',
        className,
      )}
    >
      <span className="size-[55%] rounded-[6px] border-[3px] border-bg bg-bg" />
    </span>
  );
}

/** Logo + product name + edition line. */
export function Brand({
  edition,
  className,
}: {
  /** e.g. "社区版 · 试用". */
  edition: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-[17px] font-semibold tracking-tight text-text">
          OntoDecide
        </div>
        <div className="text-[11px] text-muted">{edition}</div>
      </div>
    </div>
  );
}
