/**
 * @fileoverview Empty and error states.
 */

import {AlertOctagon, Inbox, RotateCw} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../lib/cn';
import {Button} from './button';

/** Empty state with icon, title, description and optional action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-dim [&_svg]:size-5">
        {icon ?? <Inbox aria-hidden />}
      </div>
      <p className="text-sm font-medium text-text">{title}</p>
      {description && (
        <p className="max-w-md text-xs text-muted">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Error view (used by error boundaries and failed queries). */
export function ErrorView({
  title,
  detail,
  errorId,
  onRetry,
  className,
}: {
  title?: ReactNode;
  detail?: ReactNode;
  errorId?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const {t} = useTranslation('common');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full border border-crit/40 bg-crit/10 text-crit">
        <AlertOctagon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-text">
        {title ?? t('errors.generic')}
      </p>
      {detail && (
        <p className="max-w-md text-xs break-words text-muted">{detail}</p>
      )}
      {errorId && (
        <p className="text-xs text-dim">
          {t('errors.errorId')}:{' '}
          <code className="font-mono text-muted">{errorId}</code>
        </p>
      )}
      {onRetry && (
        <Button size="sm" className="mt-2" onClick={onRetry}>
          <RotateCw aria-hidden />
          {t('actions.retry')}
        </Button>
      )}
    </div>
  );
}
