/**
 * @fileoverview Table primitives styled for dense data.
 */

import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import {cn} from '../lib/cn';

/** Scrollable table wrapper. */
export const Table = forwardRef<
  HTMLTableElement,
  HTMLAttributes<HTMLTableElement>
>(({className, ...props}, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn('w-full caption-bottom border-collapse text-sm', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

/** Table head. */
export function THead({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('sticky top-0 z-[1] bg-panel-solid', className)}
      {...props}
    />
  );
}

/** Table body. */
export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

/** Table row. */
export function Tr({className, ...props}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-line transition-colors hover:bg-panel-2/70',
        className,
      )}
      {...props}
    />
  );
}

/** Header cell. */
export function Th({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted',
        className,
      )}
      {...props}
    />
  );
}

/** Data cell. */
export function Td({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-3 py-2 align-middle text-text', className)}
      {...props}
    />
  );
}
