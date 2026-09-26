/**
 * @fileoverview Wizard step 5: first 5 transformed rows, validation stats
 * over all parsed rows (valid / would reject with reasons / clamped), the
 * upload plan (N batches × ≤ 500 rows, 3 concurrent, estimated time) and
 * the two progress bars while importing (archive PUT, batches).
 */

import {
  INGEST_LIMITS,
  type MappingSpec,
  type QualityRule,
  type SourceKind,
} from '@ontodecide/integration/contract';
import type {CompiledObjectType} from '@ontodecide/ontology/contract';
import {
  AlertOctagon,
  Archive,
  CheckCircle2,
  Copy,
  KeyRound,
  Layers,
  RotateCw,
  Scissors,
  Timer,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import {useMemo, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import type {UiObjectType} from '../../../entities/schema/model';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {Badge, StatusBadge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Panel} from '../../../shared/ui/card';
import {Progress} from '../../../shared/ui/progress';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {toast} from '../../../shared/ui/toast';
import type {ParsedFile} from '../parse_client';
import {previewRow, previewStats} from '../preview';
import {
  estimateSeconds,
  UPLOAD_CONCURRENCY,
  type UploadProgress,
} from '../upload';

function display(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'crit';
}) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-2.5">
      <p
        className={cn(
          'flex items-center gap-1.5 text-[11px] whitespace-nowrap text-dim [&_svg]:size-3.5',
          tone === 'good' && '[&_svg]:text-good',
          tone === 'warn' && '[&_svg]:text-warn',
          tone === 'crit' && '[&_svg]:text-crit',
        )}
      >
        {icon}
        {label}
      </p>
      <p className="num mt-1 text-[1.6rem] leading-none font-semibold text-text">
        {value}
      </p>
    </div>
  );
}

/** Upload progress bars. */
export function UploadProgressView({progress}: {progress: UploadProgress}) {
  const {t} = useTranslation('sources');
  const batchRatio = progress.batchesTotal
    ? progress.batchesDone / progress.batchesTotal
    : 0;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted">
            <Archive className="size-3.5" aria-hidden />
            {t('preview.progress.archive')}
          </span>
          <span className="num text-text">
            {progress.archiveSkipped
              ? t('preview.progress.archiveSkipped')
              : fmt.percent(progress.archive)}
          </span>
        </div>
        <Progress
          value={progress.archive}
          label={t('preview.progress.archive')}
          tone={progress.archiveSkipped ? 'warn' : 'accent'}
        />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted">
            <Layers className="size-3.5" aria-hidden />
            {t('preview.progress.batches')}
          </span>
          <span className="num text-text">
            {t('preview.progress.batchesValue', {
              done: progress.batchesDone,
              total: progress.batchesTotal,
            })}
            {progress.inFlight > 0 && (
              <span className="ml-2 text-dim">
                {t('preview.progress.inFlight', {count: progress.inFlight})}
              </span>
            )}
          </span>
        </div>
        <Progress
          value={batchRatio}
          label={t('preview.progress.batches')}
          tone={
            progress.batchesDone === progress.batchesTotal ? 'good' : 'accent'
          }
        />
        {progress.retrying > 0 && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-warn">
            <RotateCw className="size-3 animate-spin" aria-hidden />
            {t('preview.progress.retrying', {count: progress.retrying})}
          </p>
        )}
      </div>
    </div>
  );
}

/** Step 5 for file sources. */
export function PreviewStep({
  parsed,
  mapping,
  rules,
  compiled,
  type,
  progress,
  error,
}: {
  parsed: ParsedFile;
  mapping: MappingSpec;
  rules: QualityRule[];
  compiled?: CompiledObjectType;
  type?: UiObjectType;
  progress: UploadProgress | null;
  error: string | null;
}) {
  const {t} = useTranslation('sources');
  // One "now" per render pass keeps freshness rules stable while previewing.
  const now = useMemo(() => new Date(), []);
  const {first, stats} = useMemo(() => {
    if (!compiled) return {first: [], stats: null};
    const ctx = {mapping, rules, targetType: compiled, now};
    return {
      first: parsed.rows.slice(0, 5).map((r, i) => previewRow(r, i + 1, ctx)),
      stats: previewStats(parsed.rows, ctx),
    };
  }, [parsed, mapping, rules, compiled, now]);
  const batches = Math.ceil(parsed.rows.length / INGEST_LIMITS.batchRecordsMax);
  const est = estimateSeconds(batches, parsed.size);
  const cols = mapping.fields.map(f => f.to);
  const propName = (api: string) =>
    type?.properties.find(p => p.apiName === api)?.displayName ?? api;

  return (
    <div className="grid grid-cols-12 gap-3.5">
      <Panel
        className="col-span-12"
        title={t('preview.rowsTitle')}
        subtitle={t('preview.rowsSubtitle')}
      >
        <div className="overflow-auto rounded-lg border border-line">
          <Table aria-label={t('preview.rowsTitle')}>
            <THead>
              <tr>
                <Th className="w-10 text-right">#</Th>
                <Th>{t('preview.status')}</Th>
                <Th>
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="size-3" aria-hidden />
                    {t('mapping.primaryKey')}
                  </span>
                </Th>
                {cols.map(c => (
                  <Th key={c}>{propName(c)}</Th>
                ))}
                {(mapping.links?.length ?? 0) > 0 && (
                  <Th>{t('mapping.links.title')}</Th>
                )}
              </tr>
            </THead>
            <TBody>
              {first.map(r => (
                <Tr key={r.row}>
                  <Td className="num text-right text-xs text-dim">{r.row}</Td>
                  <Td>
                    {r.ok ? (
                      r.clamped.length > 0 ? (
                        <StatusBadge level="warn">
                          {t('preview.clampedBadge')}
                        </StatusBadge>
                      ) : (
                        <StatusBadge level="good">
                          {t('preview.validBadge')}
                        </StatusBadge>
                      )
                    ) : (
                      <span title={r.detail}>
                        <StatusBadge level="crit">{r.code}</StatusBadge>
                      </span>
                    )}
                  </Td>
                  {r.ok ? (
                    <>
                      <Td className="font-mono text-xs">{r.primaryKey}</Td>
                      {cols.map(c => (
                        <Td
                          key={c}
                          className={cn(
                            'max-w-48 truncate font-mono text-xs',
                            r.clamped.includes(c) && 'text-warn',
                          )}
                          title={display(r.props[c])}
                        >
                          {display(r.props[c]) || (
                            <span className="text-dim">—</span>
                          )}
                        </Td>
                      ))}
                      {(mapping.links?.length ?? 0) > 0 && (
                        <Td className="text-xs">
                          {r.links.map(l => l.toKey).join(', ')}
                        </Td>
                      )}
                    </>
                  ) : (
                    <Td
                      colSpan={
                        cols.length +
                        1 +
                        ((mapping.links?.length ?? 0) > 0 ? 1 : 0)
                      }
                      className="text-xs text-crit"
                    >
                      {r.detail}
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      </Panel>

      <Panel
        className="col-span-12 lg:col-span-7"
        title={t('preview.statsTitle')}
        subtitle={t('preview.statsSubtitle', {count: parsed.rows.length})}
      >
        {stats && (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat
                icon={<Layers aria-hidden />}
                label={t('preview.stats.total')}
                value={fmt.number(stats.total)}
              />
              <Stat
                icon={<CheckCircle2 aria-hidden />}
                label={t('preview.stats.valid')}
                value={fmt.number(stats.valid)}
                tone="good"
              />
              <Stat
                icon={<XCircle aria-hidden />}
                label={t('preview.stats.rejected')}
                value={fmt.number(stats.rejected)}
                tone="crit"
              />
              <Stat
                icon={<Scissors aria-hidden />}
                label={t('preview.stats.clamped')}
                value={fmt.number(stats.clamped)}
                tone="warn"
              />
            </div>
            {stats.warned > 0 && (
              <p className="mt-2 flex items-center gap-1 text-xs text-warn">
                <TriangleAlert className="size-3.5" aria-hidden />
                {t('preview.stats.warned', {count: stats.warned})}
              </p>
            )}
            {stats.reasons.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-muted">
                  {t('preview.reasons')}
                </p>
                <ul
                  className="flex max-h-48 flex-col gap-1 overflow-auto"
                  aria-label={t('preview.reasons')}
                >
                  {stats.reasons.slice(0, 20).map(r => (
                    <li
                      key={`${r.code}-${r.detail}`}
                      className="flex items-start gap-2 rounded-md border border-line px-2 py-1.5 text-xs"
                    >
                      <Badge tone="crit" className="font-mono">
                        {r.code}
                      </Badge>
                      <span className="min-w-0 flex-1 break-words text-text">
                        {r.detail}
                      </span>
                      <span className="num whitespace-nowrap text-muted">
                        {t('preview.reasonCount', {
                          count: r.count,
                          row: r.example,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-good">
                <CheckCircle2 className="size-3.5" aria-hidden />
                {t('preview.allValid')}
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel
        className="col-span-12 lg:col-span-5"
        title={t('preview.planTitle')}
        subtitle={t('preview.planSubtitle')}
      >
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-2">
            <dt className="text-dim">{t('preview.plan.batches')}</dt>
            <dd className="num mt-0.5 text-sm font-medium text-text">
              {t('preview.plan.batchesValue', {
                count: batches,
                size: INGEST_LIMITS.batchRecordsMax,
              })}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-2">
            <dt className="text-dim">{t('preview.plan.concurrency')}</dt>
            <dd className="num mt-0.5 text-sm font-medium text-text">
              {t('preview.plan.concurrencyValue', {count: UPLOAD_CONCURRENCY})}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-2">
            <dt className="flex items-center gap-1 text-dim">
              <Timer className="size-3" aria-hidden />
              {t('preview.plan.eta')}
            </dt>
            <dd className="num mt-0.5 text-sm font-medium text-text">
              {t('preview.plan.etaValue', {seconds: est})}
            </dd>
          </div>
          <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-2">
            <dt className="text-dim">{t('preview.plan.retry')}</dt>
            <dd className="mt-0.5 text-sm font-medium text-text">
              2s · 4s · 8s
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-dim">{t('preview.plan.note')}</p>
        {progress && (
          <div className="mt-4 border-t border-line pt-3">
            <UploadProgressView progress={progress} />
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit"
          >
            <AlertOctagon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}
      </Panel>
    </div>
  );
}

/** Step 5 for REST / webhook sources: a summary before enabling. */
export function ConnectorSummary({
  kind,
  name,
  mapping,
  rules,
  webhookSecret,
  sourceId,
  type,
}: {
  kind: SourceKind;
  name: string;
  mapping: MappingSpec;
  rules: QualityRule[];
  webhookSecret: string | null;
  sourceId?: string;
  type?: UiObjectType;
}) {
  const {t} = useTranslation('sources');
  const endpoint = sourceId
    ? `${globalThis.location?.origin ?? ''}/api/v1/ingest/webhook/${sourceId}`
    : '';
  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(t('common:actions.copied')));
  };
  return (
    <div className="grid grid-cols-12 gap-3.5">
      <Panel
        className="col-span-12 lg:col-span-6"
        title={t('summary.title')}
        subtitle={t(`kinds.${kind}.title`)}
      >
        <dl className="flex flex-col divide-y divide-line text-sm">
          {[
            [t('settings.name'), name],
            [t('settings.targetType'), type?.displayName ?? mapping.targetType],
            [t('mapping.primaryKey'), mapping.primaryKey.from],
            [t('summary.fields'), String(mapping.fields.length)],
            [t('summary.links'), String(mapping.links?.length ?? 0)],
            [t('summary.rules'), String(rules.length)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-1.5">
              <dt className="text-muted">{k}</dt>
              <dd className="font-medium text-text">{v}</dd>
            </div>
          ))}
        </dl>
        {kind === 'rest' && (
          <p className="mt-3 text-xs text-dim">{t('summary.restNote')}</p>
        )}
      </Panel>
      {kind === 'webhook' && (
        <Panel
          className="col-span-12 lg:col-span-6"
          title={t('webhook.secretTitle')}
          subtitle={t('webhook.secretOnce')}
        >
          <div className="flex flex-col gap-3 text-xs">
            <div>
              <p className="mb-1 text-dim">{t('webhook.endpoint')}</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-panel-2 px-2 py-1.5 font-mono text-text">
                  {endpoint}
                </code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('webhook.copyEndpoint')}
                  onClick={() => copy(endpoint)}
                >
                  <Copy aria-hidden />
                </Button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-dim">{t('webhook.secret')}</p>
              {webhookSecret ? (
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded border border-violet/40 bg-violet/10 px-2 py-1.5 font-mono text-text">
                    {webhookSecret}
                  </code>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('webhook.copySecret')}
                    onClick={() => copy(webhookSecret)}
                  >
                    <Copy aria-hidden />
                  </Button>
                </div>
              ) : (
                <p className="text-warn">{t('webhook.secretGone')}</p>
              )}
            </div>
            <p className="text-dim">{t('webhook.signHint')}</p>
          </div>
        </Panel>
      )}
    </div>
  );
}
