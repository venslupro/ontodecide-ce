/**
 * @fileoverview Glass panel (card) primitives.
 */

import {forwardRef, type HTMLAttributes, type ReactNode} from 'react';
import {cn} from '../lib/cn';

/** Glass card container. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({className, ...props}, ref) => (
    <div ref={ref} className={cn('glass', className)} {...props} />
  ),
);
Card.displayName = 'Card';

/** Card header row with title and optional actions. */
export function CardHeader({
  title,
  subtitle,
  actions,
  icon,
  className,
  titleId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 px-4 pt-3.5 pb-2',
        className,
      )}
    >
      <div className="min-w-0">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-sm font-semibold text-text"
        >
          {icon && <span className="text-cyan [&_svg]:size-4">{icon}</span>}
          <span className="truncate">{title}</span>
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {actions}
        </div>
      )}
    </div>
  );
}

/** Card body. */
export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4', className)} {...props} />;
}

/** A labelled section card (header + body). */
export function Panel({
  title,
  subtitle,
  actions,
  icon,
  className,
  bodyClassName,
  children,
  ...rest
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section className={cn('glass flex min-w-0 flex-col', className)} {...rest}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={actions}
        icon={icon}
      />
      <div className={cn('min-h-0 flex-1 px-4 pb-4', bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
