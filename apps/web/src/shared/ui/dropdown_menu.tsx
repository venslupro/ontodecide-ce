/**
 * @fileoverview Dropdown menu built on Radix.
 */

import * as M from '@radix-ui/react-dropdown-menu';
import {Check} from 'lucide-react';
import type {ComponentPropsWithoutRef, ReactNode} from 'react';
import {cn} from '../lib/cn';

/** Menu root. */
export const DropdownMenu = M.Root;
/** Menu trigger. */
export const DropdownMenuTrigger = M.Trigger;
/** Menu group. */
export const DropdownMenuGroup = M.Group;

/** Menu content panel. */
export function DropdownMenuContent({
  className,
  align = 'end',
  ...props
}: ComponentPropsWithoutRef<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-44 rounded-[10px] border border-line-2 bg-panel-solid p-1 text-sm text-text shadow-[var(--shadow)]',
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

/** Menu item. */
export function DropdownMenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-panel-2 data-[highlighted]:text-cyan [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

/** Checkable menu item. */
export function DropdownMenuCheckboxItem({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-7 outline-none select-none data-[highlighted]:bg-panel-2',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <M.ItemIndicator>
          <Check className="size-3.5 text-cyan" />
        </M.ItemIndicator>
      </span>
      {children}
    </M.CheckboxItem>
  );
}

/** Menu label. */
export function DropdownMenuLabel({children}: {children: ReactNode}) {
  return <M.Label className="px-2 py-1 text-xs text-dim">{children}</M.Label>;
}

/** Menu separator. */
export function DropdownMenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}
