/**
 * @fileoverview Page title area: breadcrumb path, title, purpose, actions.
 */

import type {ReactNode} from 'react';
import {cn} from '../lib/cn';

/** Page header. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
  badges,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  badges?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'mb-4 flex flex-wrap items-end justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0">
        {breadcrumb && (
          <nav aria-label="breadcrumb" className="mb-1 text-xs text-dim">
            {breadcrumb}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-text">
            {title}
          </h1>
          {badges}
        </div>
        {description && (
          <p className="mt-1 text-sm text-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/** Monospace identifier (RID, api names). */
export function Mono({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <code className={cn('font-mono text-[12px] text-muted', className)}>
      {children}
    </code>
  );
}
