/**
 * @fileoverview Recommendation detail: AI summary and rationale, ranked
 * action table, evidence chain (deep links to property lineage), risks,
 * simulation summary, approval (optimistic, with rollback) / rejection and
 * outcome feedback.
 */

import type {
  RecommendationDto,
  RecommendedAction,
} from '@ontodecide/decision/contract';
import {parseRid, resolveText} from '@ontodecide/shared-kernel';
import {Link, useParams} from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Clock,
  FileSearch,
  Languages,
  Loader2,
  MinusCircle,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useHasRole} from '../../entities/session/store';
import {useUiModel} from '../../entities/schema/api';
import {
  useApprove,
  useRecommendation,
  useReject,
} from '../../features/decision/api';
import {
  ApproveDialog,
  RejectDialog,
} from '../../features/decision/components/approval_dialogs';
import {EvidenceChain} from '../../features/decision/components/evidence_chain';
import {
  FeedbackPanel,
  OutcomeView,
} from '../../features/decision/components/feedback_panel';
import {
  KpiChart,
  KpiTable,
} from '../../features/decision/components/kpi_comparison';
import {ObjectLink} from '../../features/decision/components/object_link';
import {ParamsSummary} from '../../features/decision/components/params_summary';
import {
  RecSourceBadge,
  RecStatusBadge,
} from '../../features/decision/components/rec_status_badge';
import {actionKey, riskLevelStatus} from '../../features/decision/model';
import {errorMessage} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {useCountdown, useOnline} from '../../shared/lib/hooks';
import {track} from '../../shared/lib/telemetry';
import {AiBadge, DegradedBadge, StatusBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {PageLoader} from '../../shared/ui/skeleton';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';
import {toast} from '../../shared/ui/toast';

function BackLink() {
  const {t} = useTranslation('recommendations');
  return (
    <Link
      to="/recommendations"
      className="inline-flex items-center gap-1 hover:text-cyan"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {t('list.title')}
    </Link>
  );
}

function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}`;
}

function Expiry({rec}: {rec: RecommendationDto}) {
  const {t} = useTranslation('recommendations');
  const at = new Date(rec.expiresAt).getTime();
  const left = useCountdown(Number.isFinite(at) ? at : null);
  if (rec.status !== 'Proposed') {
    return (
      <span>{t('detail.expiresOn', {time: fmt.dateTime(rec.expiresAt)})}</span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        left > 0 && left < 3600 ? 'text-warn' : left === 0 ? 'text-crit' : '',
      )}
    >
      <Clock className="size-3.5" aria-hidden />
      <time dateTime={rec.expiresAt} title={fmt.dateTime(rec.expiresAt)}>
        {left > 0
          ? t('detail.expiresCountdown', {time: duration(left)})
          : t('detail.expired')}
      </time>
    </span>
  );
}

function ActionTable({
  actions,
  locked,
}: {
  actions: readonly RecommendedAction[];
  locked?: boolean;
}) {
  const {t, i18n} = useTranslation('recommendations');
  const {model} = useUiModel();
  const sorted = [...actions].sort((a, b) => a.rank - b.rank);
  if (sorted.length === 0)
    return <EmptyState title={t('actions.empty')} className="py-6" />;
  return (
    <Table aria-label={t('actions.title')}>
      <THead>
        <Tr>
          <Th className="w-10">{t('actions.rank')}</Th>
          <Th>{t('actions.action')}</Th>
          <Th>{t('actions.target')}</Th>
          <Th>{t('actions.params')}</Th>
          <Th className="text-right">{t('actions.impact')}</Th>
          <Th>{t('actions.requiresApproval')}</Th>
          <Th>{t('actions.execution')}</Th>
        </Tr>
      </THead>
      <TBody>
        {sorted.map(a => {
          const def = model.actions.find(x => x.apiName === a.actionType);
          return (
            <Tr key={`${actionKey(a)}:${a.rank}`}>
              <Td className="text-muted num">{a.rank}</Td>
              <Td className="font-medium whitespace-nowrap">
                {resolveText(
                  a.displayName,
                  i18n.language,
                  def?.displayName ?? a.actionType,
                )}
              </Td>
              <Td>
                <ObjectLink rid={a.target} />
              </Td>
              <Td className="text-xs">
                <ParamsSummary actionType={a.actionType} params={a.params} />
              </Td>
              <Td
                className={cn(
                  'text-right font-semibold num',
                  a.expectedImpact >= 0 ? 'text-good' : 'text-crit',
                )}
              >
                {fmt.signedPercent(a.expectedImpact)}
              </Td>
              <Td>
                {a.requiresApproval ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-warn">
                    <ShieldCheck className="size-3.5" aria-hidden />
                    {t('common:bool.true')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted">
                    <MinusCircle className="size-3.5" aria-hidden />
                    {t('common:bool.false')}
                  </span>
                )}
              </Td>
              <Td className="text-xs">
                {a.execution ? (
                  a.execution.status === 'Executed' ? (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-good">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {t('actions.executed')}
                    </span>
                  ) : (
                    <span className="inline-flex items-start gap-1 text-crit">
                      <XCircle
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden
                      />
                      <span>
                        {t('actions.execFailed')}
                        {a.execution.error && (
                          <span className="block text-muted break-words">
                            {a.execution.error}
                          </span>
                        )}
                      </span>
                    </span>
                  )
                ) : locked ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-cyan">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {t('actions.executing')}
                  </span>
                ) : (
                  <span className="text-dim">—</span>
                )}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

function Generating() {
  const {t} = useTranslation('recommendations');
  return (
    <div
      className="glass flex flex-col items-center gap-3 px-6 py-14 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex size-14 items-center justify-center rounded-full border border-violet/40 bg-violet/10">
        <Sparkles className="size-6 text-violet" aria-hidden />
        <Loader2
          className="absolute inset-0 m-auto size-14 animate-spin text-violet/40"
          aria-hidden
        />
      </div>
      <p className="text-sm font-medium text-text">{t('detail.generating')}</p>
      <p className="max-w-md text-xs text-muted">
        {t('detail.generatingHint')}
      </p>
    </div>
  );
}

/** Recommendation detail page. */
export function RecommendationPage() {
  const {t, i18n} = useTranslation('recommendations');
  const params = useParams({strict: false}) as {id?: string};
  const id = params.id ?? '';
  const q = useRecommendation(id);
  const approve = useApprove(id);
  const reject = useReject(id);
  const canOperate = useHasRole('Operator');
  const online = useOnline();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) {
    if (isApiError(q.error, 'NOT_FOUND')) {
      return (
        <div className="glass">
          <EmptyState
            icon={<FileSearch aria-hidden />}
            title={t('detail.notFound')}
            action={
              <Button asChild size="sm">
                <Link to="/recommendations">{t('detail.backToList')}</Link>
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <ErrorView
        className="glass"
        detail={errorMessage(q.error, t)}
        onRetry={() => void q.refetch()}
      />
    );
  }

  const rec = q.data;
  const focusType = parseRid(rec.focus)?.objectType;

  if (rec.status === 'Draft') {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          breadcrumb={<BackLink />}
          title={t('detail.generatingTitle')}
          badges={<RecStatusBadge status={rec.status} />}
        />
        <Generating />
      </div>
    );
  }
  if (rec.status === 'Failed') {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          breadcrumb={<BackLink />}
          title={t('detail.failedTitle')}
          badges={<RecStatusBadge status={rec.status} />}
        />
        <ErrorView
          className="glass"
          title={t('detail.failed')}
          detail={t('detail.failedHint')}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }

  const actionable = canOperate && rec.status === 'Proposed';
  const locked = rec.status === 'Approved';
  const sim = rec.simulation;
  const top = [...rec.actions].sort((a, b) => a.rank - b.rank)[0];
  const simAction = sim && top ? sim.withActions?.[actionKey(top)] : undefined;

  const onApprove = () => {
    setApproveOpen(false);
    track('rec_approve', focusType);
    approve.mutate(undefined, {
      onSuccess: r =>
        r.status === 'ExecFailed'
          ? toast.error(t('approve.execFailed'))
          : toast.success(t('approve.success')),
      onError: e => {
        const detail = errorMessage(e, t);
        toast.error(t('approve.failed'), detail);
        if (
          isApiError(e, 'INVALID_TRANSITION', 'APPROVAL_REQUIRED', 'CONFLICT')
        )
          void q.refetch();
      },
    });
  };

  const onReject = (reason: string) => {
    setRejectOpen(false);
    track('rec_reject', focusType);
    reject.mutate(reason, {
      onSuccess: () => toast.success(t('reject.success')),
      onError: e => {
        toast.error(t('reject.failed'), errorMessage(e, t));
        if (isApiError(e, 'INVALID_TRANSITION', 'CONFLICT')) void q.refetch();
      },
    });
  };

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        breadcrumb={<BackLink />}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="break-words">{rec.summary || t('noSummary')}</span>
          </span>
        }
        badges={
          <>
            <span
              role="status"
              aria-label={t('detail.statusAria')}
              className="inline-flex"
            >
              <RecStatusBadge status={rec.status} />
            </span>
            <RecSourceBadge model={rec.model} />
            {rec.degraded && <DegradedBadge reason={t('degradedHint')} />}
          </>
        }
        actions={
          actionable ? (
            <>
              <Button
                variant="danger"
                onClick={() => setRejectOpen(true)}
                disabled={!online || reject.isPending}
              >
                <XCircle aria-hidden />
                {t('reject.open')}
              </Button>
              <Button
                variant="primary"
                onClick={() => setApproveOpen(true)}
                disabled={!online || approve.isPending}
              >
                <ShieldCheck aria-hidden />
                {t('approve.open')}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="glass flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          {t('detail.model')}
          <code className="font-mono text-text">
            {rec.model === 'rules' ? t('rulesBadge') : rec.model}
          </code>
        </span>
        <span className="num">{t('confidence', {value: rec.confidence})}</span>
        <Expiry rec={rec} />
        <span className="inline-flex items-center gap-1">
          <Target className="size-3.5" aria-hidden />
          {t('focus')} <ObjectLink rid={rec.focus} />
        </span>
        {rec.alertId && (
          <span className="inline-flex items-center gap-1">
            <Bell className="size-3.5" aria-hidden />
            {t('detail.alert')}
            <Link to="/cockpit" className="font-mono text-cyan hover:underline">
              {rec.alertId}
            </Link>
          </span>
        )}
        {rec.scenarioId && (
          <span className="inline-flex items-center gap-1">
            {t('detail.scenario')}
            <Link
              to="/scenarios/$id"
              params={{id: rec.scenarioId}}
              className="font-mono text-cyan hover:underline"
            >
              {rec.scenarioId}
            </Link>
          </span>
        )}
        <span>{t('createdAgo', {time: fmt.ago(rec.createdAt)})}</span>
        {rec.degraded && <span className="text-warn">{t('degradedHint')}</span>}
      </div>

      {rec.locale && rec.locale !== i18n.language && rec.model !== 'rules' && (
        <p className="flex items-center gap-1.5 rounded-[10px] border border-line bg-panel-2/60 px-3 py-2 text-xs text-muted">
          <Languages className="size-3.5 text-cyan" aria-hidden />
          {t('detail.localeHint', {locale: rec.locale})}
        </p>
      )}

      {rec.status === 'Rejected' && rec.rejectReason && (
        <div
          role="note"
          className="rounded-[10px] border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-text"
        >
          <span className="font-medium text-crit">
            {t('detail.rejectReason')}
          </span>{' '}
          {rec.rejectReason}
        </div>
      )}
      {rec.decidedAt && rec.status !== 'Proposed' && (
        <p className="text-xs text-dim">
          {t('detail.decided', {
            time: fmt.dateTime(rec.decidedAt),
            by: rec.approvedBy ?? '—',
          })}
        </p>
      )}

      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 flex min-w-0 flex-col gap-3.5 xl:col-span-8">
          <Panel
            title={t('detail.rationale')}
            actions={
              rec.model === 'rules' ? (
                <RecSourceBadge model="rules" />
              ) : (
                <AiBadge />
              )
            }
          >
            <p className="text-sm leading-6 whitespace-pre-line break-words text-text">
              {rec.rationale || '—'}
            </p>
          </Panel>

          <Panel title={t('actions.title')} subtitle={t('actions.subtitle')}>
            <ActionTable actions={rec.actions} locked={locked} />
          </Panel>

          {sim && (
            <Panel
              title={t('simulation.title')}
              subtitle={t('simulation.subtitle')}
              actions={
                <>
                  <StatusBadge level={riskLevelStatus(sim.riskLevel)}>
                    {t('simulation.risk', {
                      level: t(`common:severity.${sim.riskLevel}`),
                    })}
                  </StatusBadge>
                  {sim.degraded && <DegradedBadge />}
                </>
              }
            >
              <div className="grid grid-cols-12 gap-3.5">
                <div className="col-span-12 lg:col-span-5">
                  <KpiChart result={sim} withAction={simAction} height={200} />
                </div>
                <div className="col-span-12 lg:col-span-7">
                  <KpiTable result={sim} withAction={simAction} />
                </div>
              </div>
            </Panel>
          )}
        </div>

        <div className="col-span-12 flex min-w-0 flex-col gap-3.5 xl:col-span-4">
          <Panel title={t('evidence.title')} subtitle={t('evidence.subtitle')}>
            <EvidenceChain evidence={rec.evidence} />
          </Panel>

          <Panel title={t('risks.title')}>
            {rec.risks.length === 0 ? (
              <p className="text-sm text-dim">{t('risks.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {rec.risks.map(r => (
                  <li
                    key={r}
                    className="flex items-start gap-2 text-sm text-text"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-warn"
                      aria-hidden
                    />
                    <span className="break-words">{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {rec.status === 'Evaluated' && rec.outcome && (
            <Panel title={t('outcome.title')}>
              <OutcomeView outcome={rec.outcome} />
            </Panel>
          )}

          {(rec.status === 'Executed' || rec.status === 'Evaluated') && (
            <Panel title={t('feedback.title')}>
              {canOperate || rec.feedback ? (
                <FeedbackPanel rec={rec} />
              ) : (
                <p className="text-sm text-dim">—</p>
              )}
            </Panel>
          )}
        </div>
      </div>

      {actionable && (
        <>
          <ApproveDialog
            open={approveOpen}
            onOpenChange={setApproveOpen}
            actions={rec.actions}
            onConfirm={onApprove}
          />
          <RejectDialog
            open={rejectOpen}
            onOpenChange={setRejectOpen}
            onConfirm={onReject}
          />
        </>
      )}
    </div>
  );
}
