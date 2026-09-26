/**
 * @fileoverview Tabs built on Radix Tabs.
 */

import * as T from '@radix-ui/react-tabs';
import type {ComponentPropsWithoutRef} from 'react';
import {cn} from '../lib/cn';

/** Tabs root. */
export const Tabs = T.Root;

/** Tab list. */
export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof T.List>) {
  return (
    <T.List
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-panel-2 p-0.5',
        className,
      )}
      {...props}
    />
  );
}

/** Tab trigger. */
export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[8px] px-3 text-xs font-medium whitespace-nowrap text-muted transition-colors hover:text-text data-[state=active]:bg-cyan/15 data-[state=active]:text-cyan [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}

/** Tab panel. */
export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof T.Content>) {
  return <T.Content className={cn('outline-none', className)} {...props} />;
}
