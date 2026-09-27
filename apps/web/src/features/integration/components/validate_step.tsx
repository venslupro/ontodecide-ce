/**
 * @fileoverview Wizard step 4 (校验): required / type / primary-key
 * conflict checks and over-limit rows, listed row by row with reasons
 * (column and error type only), with a way back to the mapping.
 */

import {CE_LIMITS} from '@ontodecide/shared-kernel';
import {useTranslation} from 'react-i18next';
import {Badge, StatusBadge} from '../../../shared/ui/badge';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import type {PlanQuota, UploadPlan, ValidationSummary} from '../preview';
import {useRejectReason} from './rejected_table';

/** Rows listed at most. */
export const MAX_LISTED = 200;

/** Pass / reject / over-limit counters. */
export function SummaryBadges({summary}: {summary: ValidationSummary}) {
  const {t} = useTranslation('imports');
  return (
    <div className="flex flex-wrap gap-2" role="status">
      <StatusBadge level="good">
        {t('validate.summary.passed', {count: summary.passed})}
      </StatusBadge>
      <StatusBadge level={summary.rejected > 0 ? 'crit' : 'good'}>
        {t('validate.summary.rejected', {count: summary.rejected})}
      </StatusBadge>
      {summary.overLimit > 0 && (
        <StatusBadge level="warn">
          {t('validate.summary.overLimit', {count: summary.overLimit})}
        </StatusBadge>
      )}
    </div>
  );
}

function limitLeft(plan: UploadPlan, quota: PlanQuota): number {
  if (plan.limitedBy === 'importRows') return quota.importRowsLeft;
  if (plan.limitedBy === 'objects') return quota.objectsLeft;
  if (plan.limitedBy === 'links') return quota.linksLeft ?? 0;
  return CE_LIMITS.importRowsDaily;
}

/** Step 4: row-by-row validation results. */
export function ValidateStep({
  summary,
  plan,
  quota,
}: {
  summary: ValidationSummary;
  plan: UploadPlan;
  quota: PlanQuota;
}) {
  const {t} = useTranslation('imports');
  const reason = useRejectReason();
  const listed = summary.rejects.slice(0, MAX_LISTED);
  const hidden = summary.rejects.length - listed.length;
  const clean = summary.rejected === 0 && summary.overLimit === 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('validate.checks')}</p>
      <SummaryBadges summary={summary} />
      {clean ? (
        <p className="text-sm text-good">{t('validate.allPassed')}</p>
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border border-line">
          <Table aria-label={t('validate.title')}>
            <THead>
              <Tr>
                <Th>{t('validate.col.row')}</Th>
                <Th>{t('validate.col.column')}</Th>
                <Th>{t('validate.col.reason')}</Th>
              </Tr>
            </THead>
            <TBody>
              {listed.map(r => (
                <Tr key={r.row}>
                  <Td className="num text-xs">{r.row}</Td>
                  <Td className="font-mono text-xs">{r.column ?? '—'}</Td>
                  <Td>
                    <Badge tone="crit">{reason(r.code)}</Badge>
                  </Td>
                </Tr>
              ))}
              {summary.overLimit > 0 && plan.limitedBy && (
                <Tr>
                  <Td className="num text-xs">
                    {t('validate.overLimitRows', {
                      from: plan.submitRows + 1,
                      to: plan.totalRows,
                    })}
                  </Td>
                  <Td>—</Td>
                  <Td>
                    <Badge tone="warn">
                      {t(`validate.overLimitReason.${plan.limitedBy}`, {
                        left: limitLeft(plan, quota),
                      })}
                    </Badge>
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
        </div>
      )}
      {hidden > 0 && (
        <p className="text-xs text-dim">
          {t('validate.more', {count: hidden})}
        </p>
      )}
      {summary.rejected > 0 && (
        <p className="text-xs text-muted">{t('validate.rejectedNote')}</p>
      )}
    </div>
  );
}
