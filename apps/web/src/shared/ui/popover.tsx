/**
 * @fileoverview Popover built on Radix Popover.
 */

import * as P from '@radix-ui/react-popover';
import type {ComponentPropsWithoutRef} from 'react';
import {cn} from '../lib/cn';

/** Popover root. */
export const Popover = P.Root;
/** Popover trigger. */
export const PopoverTrigger = P.Trigger;
/** Popover anchor. */
export const PopoverAnchor = P.Anchor;

/** Popover content. */
export function PopoverContent({
  className,
  align = 'start',
  ...props
}: ComponentPropsWithoutRef<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 rounded-[10px] border border-line-2 bg-panel-solid p-3 text-sm text-text shadow-[var(--shadow)] outline-none',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
