/**
 * @fileoverview Loading placeholders.
 */

import {Loader2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../lib/cn';

/** Pulsing placeholder block. */
export function Skeleton({className}: {className?: string}) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-line', className)}
    />
  );
}

/** Inline spinner with an accessible label. */
export function Spinner({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const {t} = useTranslation('common');
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 text-sm text-muted',
        className,
      )}
    >
      <Loader2 className="size-4 animate-spin text-cyan" aria-hidden />
      <span className="sr-only">{label ?? t('state.loading')}</span>
    </span>
  );
}

/** Centered page-level loader. */
export function PageLoader() {
  const {t} = useTranslation('common');
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-6 animate-spin text-cyan" aria-hidden />
      <span className="sr-only">{t('state.loading')}</span>
    </div>
  );
}
