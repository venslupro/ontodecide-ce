/**
 * @fileoverview Wizard step 5 (预览与运行): transformed sample rows with
 * pass / reject counts, the upload plan card ("浏览器内解析 → N 批 × 行数
 * （原始文件不上传）", estimate, remaining import rows today, over-limit
 * rows) and the run button with the batch progress bar.
 */

import type {MappingSpec} from '@ontodecide/integration/contract';
import {Play, RotateCw, Square, UploadCloud} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../../../shared/api/error_message';
import {isApiError} from '../../../shared/api/errors';
import {Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Progress} from '../../../shared/ui/progress';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {QuotaNotice} from '../../situation/components/quota_notice';
import type {UploadPlan, ValidationSummary} from '../preview';
import {
  RowTooLargeError,
  UploadAbortedError,
  type UploadProgress,
} from '../upload';
import {useRejectReason} from './rejected_table';
import {cellText} from './sample_table';
import {SummaryBadges} from './validate_step';

/** Rows shown in the preview table. */
export const PREVIEW_ROWS = 10;

function RunError({error}: {error: unknown}) {
  const {t} = useTranslation('imports');
  if (error instanceof UploadAbortedError) {
    return <p className="text-xs text-muted">{t('run.aborted')}</p>;
  }
  if (isApiError(error, 'QUOTA_EXCEEDED')) {
    return <QuotaNotice error={error} quota="importRowsToday" />;
  }
  const message =
    error instanceof RowTooLargeError
      ? t('run.rowTooLarge', {row: error.row})
      : errorMessage(error, t);
  return (
    <p role="alert" className="text-xs text-crit">
      {t('run.failed', {message})}
    </p>
  );
}

/** Step 5: preview, upload plan and run. */
export function PreviewStep({
  summary,
  spec,
  plan,
  importRows,
  running,
  progress,
  runError,
  canResume,
  retryIn = 0,
  onRun,
  onCancel,
}: {
  summary: ValidationSummary;
  spec: MappingSpec;
  plan: UploadPlan;
  importRows: {left: number; limit: number};
  running: boolean;
  progress: UploadProgress | null;
  runError: unknown;
  canResume: boolean;
  /** Seconds left of a 429 RATE_LIMITED wait (0: may run). */
  retryIn?: number;
  onRun: () => void;
  onCancel: () => void;
}) {
  const {t} = useTranslation('imports');
  const reason = useRejectReason();
  const cols = [...new Set(spec.fields.map(f => f.to))];
  const shown = summary.outcomes.slice(0, PREVIEW_ROWS);
  const ratio =
    progress && progress.batchesTotal > 0
      ? progress.batchesDone / progress.batchesTotal
      : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">
            {t('run.preview')}
          </h2>
          <SummaryBadges summary={summary} />
        </div>
        <p className="text-xs text-dim">
          {t('run.previewHint', {count: shown.length})}
        </p>
        <div className="overflow-x-auto rounded-lg border border-line">
          <Table aria-label={t('run.preview')}>
            <THead>
              <Tr>
                <Th className="w-10 text-right">#</Th>
                {cols.map(c => (
                  <Th key={c} className="font-mono">
                    {c}
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {shown.map(o => (
                <Tr key={o.row}>
                  <Td className="num text-right text-xs text-dim">{o.row}</Td>
                  {o.ok ? (
                    cols.map(c => (
                      <Td key={c} className="max-w-48 truncate text-xs">
                        {cellText(o.props[c])}
                      </Td>
                    ))
                  ) : (
                    <Td colSpan={cols.length} className="text-xs">
                      <span className="mr-2 text-dim">—</span>
                      <Badge tone="crit">{reason(o.code)}</Badge>
                      {o.column && (
                        <span className="ml-2 font-mono text-dim">
                          {o.column}
                        </span>
                      )}
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      </section>
      <section
        className="glass flex flex-col gap-3 p-4"
        aria-labelledby="import-plan-title"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2
            id="import-plan-title"
            className="flex items-center gap-2 text-sm font-semibold text-text"
          >
            <UploadCloud className="size-4 text-cyan" aria-hidden />
            {t('run.plan')}
          </h2>
          <span className="text-xs text-muted">
            {t('run.eta', {seconds: plan.estimatedSeconds})}
          </span>
        </div>
        <p className="text-sm text-text">
          {t('run.planLine', {batches: plan.batches, rows: plan.batchRows})}
        </p>
        <p className="num text-xs text-muted">
          {t('run.remaining', importRows)}
        </p>
        {plan.overLimitRows > 0 && (
          <p className="text-xs text-warn">
            {t('run.overLimit', {count: plan.overLimitRows})}
          </p>
        )}
        {plan.submitRows === 0 && (
          <p className="text-xs text-warn">{t('run.nothing')}</p>
        )}
        {progress && (
          <div className="flex flex-col gap-1.5">
            <Progress value={ratio} label={t('run.progressLabel')} />
            <p className="num text-xs text-muted" role="status">
              {t('run.progress', {
                done: progress.batchesDone,
                total: progress.batchesTotal,
                rows: progress.rowsSent,
              })}
              {progress.attempt > 0 &&
                ` · ${t('run.retrying', {attempt: progress.attempt})}`}
            </p>
          </div>
        )}
        {runError !== null && runError !== undefined && !running && (
          <RunError error={runError} />
        )}
        <div className="flex justify-end gap-2">
          {running ? (
            <Button variant="outline" onClick={onCancel}>
              <Square aria-hidden />
              {t('run.cancel')}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={onRun}
              disabled={plan.submitRows === 0 || retryIn > 0}
            >
              {canResume ? <RotateCw aria-hidden /> : <Play aria-hidden />}
              {retryIn > 0
                ? t('common:rateLimit.retryIn', {seconds: retryIn})
                : canResume
                  ? t('run.resume')
                  : t('run.start')}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
