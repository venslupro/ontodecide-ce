/**
 * @fileoverview Empty and error states.
 */

import {AlertOctagon, Inbox, RotateCw} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../lib/cn';
import {APP_VERSION} from '../lib/version';
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

/**
 * Error view (used by error boundaries and failed queries). The API
 * `traceId` and the build version are shown as support details (前端详细设计
 * 6.6: "traceId 显示在错误详情中").
 */
export function ErrorView({
  title,
  detail,
  errorId,
  traceId,
  onRetry,
  className,
}: {
  title?: ReactNode;
  detail?: ReactNode;
  errorId?: string;
  /** Problem Details `traceId` (or X-Request-Id) of a failed API call. */
  traceId?: string;
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
      {(errorId || traceId) && (
        <p className="flex flex-wrap justify-center gap-x-3 text-xs text-dim">
          {errorId && (
            <span>
              {t('errors.errorId')}:{' '}
              <code className="font-mono text-muted">{errorId}</code>
            </span>
          )}
          {traceId && (
            <span>
              {t('errors.traceId')}:{' '}
              <code className="font-mono text-muted">{traceId}</code>
            </span>
          )}
          <span>{t('about.version', {version: APP_VERSION})}</span>
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
