/**
 * @fileoverview "Compare & publish" dialog: computes the draft vs current
 * diff, highlights breaking changes (icon + text), and requires typing the
 * suggested version before a breaking publish.
 */

import type {
  DiffReport,
  PublishReport,
  SchemaChange,
} from '@ontodecide/ontology/contract';
import {AlertOctagon, ArrowRight, CheckCircle2, GitCompare} from 'lucide-react';
import {useEffect, useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../../../shared/api/error_message';
import {isApiError} from '../../../shared/api/errors';
import {useOnline} from '../../../shared/lib/hooks';
import {StatusBadge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogClose, DialogContent} from '../../../shared/ui/dialog';
import {EmptyState, ErrorView} from '../../../shared/ui/empty_state';
import {Field, Input} from '../../../shared/ui/input';
import {Mono} from '../../../shared/ui/page_header';
import {Spinner} from '../../../shared/ui/skeleton';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {useDiff, usePublish} from '../api';

/** Dialog props. */
export interface DiffPublishDialogProps {
  apiName: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onPublished(report: PublishReport): void;
}

function ChangeRow({change}: {change: SchemaChange}) {
  const {t} = useTranslation('ontology');
  return (
    <Tr className={change.breaking ? 'bg-crit/5' : undefined}>
      <Td className="whitespace-nowrap">
        {t(`diff.kinds.${change.kind}`, {defaultValue: change.kind})}
      </Td>
      <Td>
        <Mono className="text-text">{change.path}</Mono>
      </Td>
      <Td className="text-muted">{change.detail ?? '—'}</Td>
      <Td>
        {change.breaking ? (
          <StatusBadge level="crit">{t('diff.breaking')}</StatusBadge>
        ) : (
          <StatusBadge level="good">{t('diff.compatible')}</StatusBadge>
        )}
      </Td>
    </Tr>
  );
}

function VersionLine({diff}: {diff: DiffReport}) {
  const {t} = useTranslation('ontology');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-panel-2/50 px-3 py-2.5 text-sm">
      <span className="flex items-center gap-2">
        <span className="text-muted">{t('diff.from')}</span>
        <Mono className="text-text">
          {diff.fromVersion ?? t('schema.unpublished')}
        </Mono>
        <ArrowRight className="size-3.5 text-dim" aria-hidden />
        <span className="text-muted">{t('diff.to')}</span>
        <Mono className="text-text">{diff.toVersion}</Mono>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-muted">{t('diff.suggested')}</span>
        <Mono className="text-cyan">{diff.suggestedVersion}</Mono>
      </span>
    </div>
  );
}

/** Compare & publish dialog. */
export function DiffPublishDialog({
  apiName,
  open,
  onOpenChange,
  onPublished,
}: DiffPublishDialogProps) {
  const {t} = useTranslation('ontology');
  const online = useOnline();
  const diff = useDiff(apiName);
  const publish = usePublish(apiName);
  const [typed, setTyped] = useState('');
  const [forceConfirm, setForceConfirm] = useState(false);
  const confirmId = useId();
  const {mutate: runDiff, reset: resetDiff} = diff;
  const {reset: resetPublish} = publish;

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setForceConfirm(false);
    resetPublish();
    runDiff();
  }, [open, runDiff, resetPublish]);

  const report = diff.data;
  const needsConfirm = !!report && (report.breaking || forceConfirm);
  const canPublish =
    !!report &&
    online &&
    (!needsConfirm || typed.trim() === report.suggestedVersion);
  const breakingCount = report?.changes.filter(c => c.breaking).length ?? 0;

  const doPublish = () => {
    if (!report) return;
    publish.mutate(needsConfirm ? {confirmVersion: typed.trim()} : {}, {
      onSuccess: r => {
        onPublished(r);
        onOpenChange(false);
        resetDiff();
      },
      onError: e => {
        if (isApiError(e, 'ONTOLOGY_BREAKING_CHANGE')) setForceConfirm(true);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        title={t('diff.title', {api: apiName})}
        description={t('diff.description')}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={!canPublish}
              loading={publish.isPending}
              onClick={doPublish}
            >
              {report
                ? t('diff.publishAs', {
                    version: needsConfirm
                      ? report.suggestedVersion
                      : report.toVersion,
                  })
                : t('diff.publish')}
            </Button>
          </>
        }
      >
        {diff.isPending && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
            <Spinner /> {t('diff.computing')}
          </div>
        )}
        {diff.isError && (
          <ErrorView
            detail={errorMessage(diff.error, t)}
            onRetry={() => runDiff()}
          />
        )}
        {report && (
          <div className="flex flex-col gap-4">
            <VersionLine diff={report} />
            {needsConfirm && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2.5 text-sm"
              >
                <AlertOctagon
                  className="mt-0.5 size-4 shrink-0 text-crit"
                  aria-hidden
                />
                <div>
                  <p className="font-medium text-crit">
                    {report.breaking
                      ? t('diff.breakingTitle', {count: breakingCount})
                      : t('diff.serverBreaking')}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {t('diff.breakingHint')}
                  </p>
                </div>
              </div>
            )}
            {!needsConfirm && (
              <p className="flex items-center gap-2 text-sm text-good">
                <CheckCircle2 className="size-4" aria-hidden />
                {t('diff.nonBreaking')}
              </p>
            )}
            {report.changes.length === 0 ? (
              <EmptyState
                icon={<GitCompare aria-hidden />}
                title={t('diff.noChanges')}
              />
            ) : (
              <div className="rounded-lg border border-line">
                <Table aria-label={t('diff.changes')}>
                  <THead>
                    <tr className="border-b border-line">
                      <Th>{t('diff.kind')}</Th>
                      <Th>{t('diff.path')}</Th>
                      <Th>{t('diff.detail')}</Th>
                      <Th>{t('diff.compat')}</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {report.changes.map((c, i) => (
                      <ChangeRow key={`${c.path}-${i}`} change={c} />
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
            {needsConfirm && (
              <Field
                label={t('diff.confirmLabel', {
                  version: report.suggestedVersion,
                })}
                htmlFor={confirmId}
                hint={t('diff.confirmHint')}
              >
                <Input
                  id={confirmId}
                  className="max-w-48 font-mono"
                  autoComplete="off"
                  placeholder={report.suggestedVersion}
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                />
              </Field>
            )}
            {publish.isError &&
              !isApiError(publish.error, 'ONTOLOGY_BREAKING_CHANGE') && (
                <p role="alert" className="text-sm text-crit">
                  {errorMessage(publish.error, t)}
                </p>
              )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
