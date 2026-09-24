/**
 * @fileoverview List of structural validation issues returned by the draft
 * save (path + message).
 */

import type {ValidationIssue} from '@ontodecide/ontology/contract';
import {AlertTriangle, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Button} from '../../../shared/ui/button';
import {Mono} from '../../../shared/ui/page_header';

/** Validation issues panel. */
export function ValidationIssues({
  issues,
  onDismiss,
}: {
  issues: readonly ValidationIssue[];
  onDismiss?(): void;
}) {
  const {t} = useTranslation('ontology');
  if (!issues.length) return null;
  return (
    <section
      role="alert"
      className="rounded-[14px] border border-warn/40 bg-warn/10 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-warn">
          <AlertTriangle className="size-4" aria-hidden />
          {t('validation.title', {count: issues.length})}
        </h2>
        {onDismiss && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('common:actions.close')}
            onClick={onDismiss}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
      <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
        {issues.map((i, k) => (
          <li key={`${i.path}-${k}`} className="flex flex-wrap gap-x-2">
            <Mono className="text-text">{i.path || '(root)'}</Mono>
            <span className="text-muted">{i.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
