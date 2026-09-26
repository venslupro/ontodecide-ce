/**
 * @fileoverview Candidate action checklist for a scenario: display name,
 * target, params, approval badge; ineligible candidates are disabled with
 * their unmet preconditions listed. At most 10 can be selected.
 */

import type {CandidateAction} from '@ontodecide/decision/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Ban, ListChecks, ShieldCheck} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {Badge} from '../../../shared/ui/badge';
import {EmptyState} from '../../../shared/ui/empty_state';
import {Checkbox} from '../../../shared/ui/input';
import {Skeleton} from '../../../shared/ui/skeleton';
import {actionKey} from '../model';
import {ParamsSummary} from './params_summary';

/** Maximum candidates per run (scenarioInputSchema). */
export const CANDIDATES_MAX = 10;

/** Candidate checklist. */
export function CandidateList({
  candidates,
  selected,
  onToggle,
  loading,
  disabled,
}: {
  candidates: readonly CandidateAction[] | undefined;
  selected: ReadonlySet<string>;
  onToggle(key: string, on: boolean): void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const {t, i18n} = useTranslation('scenarios');
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }
  if (!candidates || candidates.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks aria-hidden />}
        title={t('candidates.empty')}
        description={t('candidates.emptyHint')}
        className="py-6"
      />
    );
  }
  const full = selected.size >= CANDIDATES_MAX;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2" aria-label={t('candidates.title')}>
        {candidates.map(c => {
          const key = actionKey(c);
          const checked = selected.has(key);
          const off = disabled || !c.eligible || (!checked && full);
          const id = `cand-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          const name = resolveText(c.displayName, i18n.language, c.actionType);
          return (
            <li
              key={key}
              className={cn(
                'flex items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors',
                checked
                  ? 'border-cyan/50 bg-cyan/5'
                  : 'border-line bg-panel-2/50',
                !c.eligible && 'opacity-70',
              )}
            >
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={checked}
                disabled={off}
                onCheckedChange={v => onToggle(key, v === true)}
                aria-describedby={c.eligible ? undefined : `${id}-unmet`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label
                    htmlFor={id}
                    className={cn(
                      'text-sm font-medium text-text',
                      off ? 'cursor-not-allowed' : 'cursor-pointer',
                    )}
                  >
                    {name}
                    <span className="text-muted"> · {c.targetTitle}</span>
                  </label>
                  {c.requiresApproval && (
                    <Badge tone="warn">
                      <ShieldCheck aria-hidden />
                      {t('candidates.requiresApproval')}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xs">
                  <ParamsSummary actionType={c.actionType} params={c.params} />
                </div>
                {!c.eligible && (
                  <div id={`${id}-unmet`} className="mt-1.5 text-xs text-crit">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Ban className="size-3.5" aria-hidden />
                      {t('candidates.ineligible')}
                    </span>
                    {(c.unmetPreconditions ?? []).length > 0 && (
                      <ul className="mt-0.5 list-disc pl-5">
                        {c.unmetPreconditions!.map(u => (
                          <li key={u}>{u}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className={cn('text-xs num', full ? 'text-warn' : 'text-dim')}>
        {t('candidates.selectedCount', {
          count: selected.size,
          max: CANDIDATES_MAX,
        })}
      </p>
    </div>
  );
}
