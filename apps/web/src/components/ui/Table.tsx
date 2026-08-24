/**
 * Table — data table primitives. Named exports plus default Table.
 * Exports: Table, TableHeader, TableRow, TableCell.
 */
import { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

type Div = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };

export function Table({ className = '', style, children, ...rest }: Div) {
  return (
    <div
      className={className}
      style={{
        width: '100%', borderRadius: 'var(--radius-md)', overflow: 'hidden',
        border: '1px solid var(--color-neutral-200)', background: '#fff',
        ...style,
      }}
      {...rest}
    >
      <table
        style={{
          width: '100%', borderCollapse: 'collapse', fontSize: 14,
          color: 'var(--color-neutral-900)',
        }}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className = '', style, children, ...rest }: Div) {
  return (
    <thead
      className={className}
      style={{
        background: 'var(--color-neutral-50)',
        borderBottom: '1px solid var(--color-neutral-200)', ...style,
      }}
      {...rest}
    >
      <tr>{children}</tr>
    </thead>
  );
}

export function TableRow({
  className = '', style, children, isLast, ...rest
}: Div & { isLast?: boolean }) {
  return (
    <tr
      className={className}
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--color-neutral-200)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </tr>
  );
}

export interface TableCellProps
  extends TdHTMLAttributes<HTMLTableCellElement>,
    ThHTMLAttributes<HTMLTableCellElement> {
  header?: boolean;
  align?: 'left' | 'center' | 'right';
}

export function TableCell({
  header, align = 'left', className = '', style, children, ...rest
}: TableCellProps) {
  const Tag: 'th' | 'td' = header ? 'th' : 'td';
  return (
    <Tag
      className={className}
      style={{
        padding: '12px 16px', textAlign: align,
        fontWeight: header ? 600 : 400,
        color: header ? 'var(--color-neutral-700)' : 'var(--color-neutral-900)',
        fontSize: 13, verticalAlign: 'middle', ...style,
      }}
      {...(rest as any)}
    >
      {children}
    </Tag>
  );
}

export default Table;
