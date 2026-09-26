/**
 * @fileoverview Tooltip built on Radix Tooltip.
 */

import * as T from '@radix-ui/react-tooltip';
import type {ReactNode} from 'react';
import {cn} from '../lib/cn';

/** Provider (mounted once in app providers). */
export const TooltipProvider = T.Provider;

/** Wraps a trigger element with a tooltip. */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
  asChild = true,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
  asChild?: boolean;
}) {
  if (content === null || content === undefined || content === '')
    return <>{children}</>;
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild={asChild}>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-[60] max-w-sm rounded-md border border-line-2 bg-panel-solid px-2.5 py-1.5 text-xs text-text shadow-[var(--shadow)]',
            className,
          )}
        >
          {content}
          <T.Arrow className="fill-[var(--panel-solid)]" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
