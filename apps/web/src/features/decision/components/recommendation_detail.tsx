/**
 * @fileoverview Recommendation detail (前端详细设计 建议中心): summary,
 * confidence, ranking source, expiry, ranked candidates with their fixed
 * (read-only) parameters, evidence chain with lineage back to the object
 * property and the import row, risks, rationale, execution result and the
 * Owner actions 「确认并执行」 / 「驳回」.
 */

import type {Candidate, RecommendationDto} from '@ontodecide/decision/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FlaskConical,
  Lock,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {useQuotas} from '../../../entities/quota';
import {useUiModel} from '../../../entities/schema/api';
import {useObject} from '../../object-graph/api';
import {
  shortRid,
  typeOfRid,
  type UiModel,
} from '../../../entities/schema/model';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {Button} from '../../../shared/ui/button';
import {Card} from '../../../shared/ui/card';
import {Mono} from '../../../shared/ui/page_header';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {
  isDecidable,
  looksLikeRid,
  paramText,
  rankedCandidates,
  titleForRid,
  topCandidate,
} from '../model';
import {ConfirmRecommendationDialog} from './confirm_dialog';
import {RankedByBadge} from './ranked_by_badge';
import {RecStatusBadge} from './rec_status_badge';
import {RejectRecommendationDialog} from './reject_dialog';

function Section({title, children}: {title: ReactNode; children: ReactNode}) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

function ObjectLink({rid, label}: {rid: string; label?: string}) {
  // Resolve the title of references the recommendation does not name.
  const o = useObject(label ? undefined : rid);
  return (
    <Link
      to="/objects/$rid"
      params={{rid}}
      className="text-cyan hover:underline"
    >
      {label ?? o.data?.title ?? shortRid(rid)}
    </Link>
  );
}

/** Read-only parameters of a candidate (objectRef values link to objects). */
export function CandidateParams({
  candidate,
  rec,
  model,
}: {
  candidate: Candidate;
  rec: Pick<RecommendationDto, 'candidates' | 'simulation'>;
  model: UiModel;
}) {
  const {t} = useTranslation('recommendations');
  const defs = model.actionsByName[candidate.actionType]?.parameters ?? [];
  const entries = Object.entries(candidate.params);
  if (!entries.length)
    return <span className="text-dim">{t('candidates.noParams')}</span>;
  return (
    <dl className="flex flex-col gap-0.5 text-xs">
      {entries.map(([name, v]) => {
        const def = defs.find(d => d.apiName === name);
        const isRef =
          looksLikeRid(v) || !!def?.dataType.startsWith('objectRef:');
        return (
          <div key={name} className="flex flex-wrap items-baseline gap-1">
            <dt className="text-muted">{def?.displayName ?? name}:</dt>
            <dd className="num text-text">
              {isRef && typeof v === 'string' ? (
                <ObjectLink rid={v} label={titleForRid(rec, v)} />
              ) : typeof v === 'number' ? (
                fmt.number(v)
              ) : (
                paramText(v)
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function CandidatesTable({
  rec,
  model,
}: {
  rec: RecommendationDto;
  model: UiModel;
}) {
  const {t, i18n} = useTranslation('recommendations');
  const rows = rankedCandidates(rec);
  return (
    <div>
      <Table aria-label={t('candidates.aria')}>
        <THead>
          <Tr>
            <Th className="w-8">{t('candidates.rank')}</Th>
            <Th>{t('candidates.action')}</Th>
            <Th>{t('candidates.target')}</Th>
            <Th>{t('candidates.params')}</Th>
            <Th className="text-right">{t('candidates.impact')}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((c, i) => (
            <Tr key={c.id} data-testid="candidate-row">
              <Td className="num text-muted">{i + 1}</Td>
              <Td>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">
                    {resolveText(c.displayName, i18n.language, c.actionType)}
                  </span>
                  {i === 0 && isDecidable(rec) && (
                    <span className="text-[11px] text-cyan">
                      {t('candidates.top')}
                    </span>
                  )}
                </div>
                <Mono className="text-[11px] text-dim">{c.actionType}</Mono>
              </Td>
              <Td>
                <ObjectLink rid={c.target} label={c.targetTitle} />
              </Td>
              <Td>
                <CandidateParams candidate={c} rec={rec} model={model} />
              </Td>
              <Td
                className={cn(
                  'num text-right',
                  c.expectedImpact > 0
                    ? 'text-good'
                    : c.expectedImpact < 0
                      ? 'text-crit'
                      : 'text-muted',
                )}
              >
                {fmt.signedPercent(c.expectedImpact)}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-dim">
        <Lock className="size-3.5" aria-hidden />
        {t('candidates.note')}
      </p>
    </div>
  );
}

function EvidenceList({
  rec,
  model,
  timeZone,
}: {
  rec: RecommendationDto;
  model: UiModel;
  timeZone?: string;
}) {
  const {t} = useTranslation('recommendations');
  return (
    <ul
      className="flex flex-col divide-y divide-line"
      aria-label={t('evidence.title')}
    >
      {rec.evidence.length === 0 && (
        <li className="py-2 text-xs text-dim">{t('evidence.empty')}</li>
      )}
      {rec.evidence.map(e => {
        const type = typeOfRid(e.rid);
        const prop = type
          ? model.byName[type]?.properties.find(p => p.apiName === e.prop)
          : undefined;
        const label = `${titleForRid(rec, e.rid) ?? shortRid(e.rid)}.${e.prop}`;
        return (
          <li
            key={`${e.rid}:${e.prop}`}
            data-testid="evidence-item"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
          >
            <Link
              to="/objects/$rid"
              params={{rid: e.rid}}
              search={{prop: e.prop} as never}
              aria-label={t('evidence.open', {label})}
              className="inline-flex items-center gap-1 rounded-md border border-blue/40 bg-blue/10 px-2 py-0.5 font-mono text-xs text-blue hover:border-cyan"
            >
              {label}
              <ArrowUpRight className="size-3" aria-hidden />
            </Link>
            <span className="num text-text">
              {typeof e.value === 'number'
                ? fmt.number(e.value)
                : paramText(e.value)}
              {prop?.unit ? ` ${prop.unit}` : ''}
            </span>
            {e.provenance ? (
              <Link
                to="/imports/$id"
                params={{id: e.provenance.jobId}}
                className="text-xs text-muted hover:text-cyan"
              >
                {t('evidence.lineageAt', {
                  jobId: e.provenance.jobId,
                  row: e.provenance.row,
                  at: fmt.shortDateTime(e.provenance.at, timeZone),
                })}
              </Link>
            ) : (
              <span className="text-xs text-dim">
                {t('evidence.noLineage')}
              </span>
            )}
          </li>
        );
      })}
      {rec.scenarioId && (
        <li className="flex items-center gap-3 py-2 text-sm">
          <span className="rounded-md border border-violet/40 bg-violet/10 px-2 py-0.5 text-xs text-violet">
            {t('evidence.scenario')}
          </span>
          <Link
            to="/scenarios/$id"
            params={{id: rec.scenarioId}}
            className="inline-flex items-center gap-1 text-cyan hover:underline"
          >
            {t('evidence.scenarioLink', {id: rec.scenarioId.toUpperCase()})}
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </li>
      )}
    </ul>
  );
}

function ExecutionResult({rec}: {rec: RecommendationDto}) {
  const {t, i18n} = useTranslation('recommendations');
  if (!rec.execution?.length) return null;
  return (
    <Section title={t('execution.title')}>
      <ul className="flex flex-col gap-1 text-sm">
        {rec.execution.map((x, i) => {
          const c = rec.candidates.find(k => k.id === x.candidateId);
          const action = c
            ? `${resolveText(c.displayName, i18n.language, c.actionType)} → ${c.targetTitle}`
            : x.candidateId;
          const ok = x.status === 'Executed';
          return (
            <li key={i} className="flex flex-wrap items-center gap-2">
              {ok ? (
                <CheckCircle2 className="size-4 text-good" aria-hidden />
              ) : (
                <XCircle className="size-4 text-crit" aria-hidden />
              )}
              <span className={ok ? 'text-good' : 'text-crit'}>
                {t(`execution.${x.status}`, {action})}
              </span>
              {x.error && (
                <span className="text-xs text-muted">
                  {t('execution.error', {error: x.error})}
                </span>
              )}
              {x.actionLogId && (
                <Mono className="text-[11px]">
                  {t('execution.log', {id: x.actionLogId})}
                </Mono>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Full recommendation detail with the Owner decision actions. */
export function RecommendationDetail({rec}: {rec: RecommendationDto}) {
  const {t} = useTranslation('recommendations');
  const {model} = useUiModel();
  const {timeZone} = useQuotas();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const top = topCandidate(rec);
  const topType = top ? typeOfRid(top.target) : undefined;
  const decidable = isDecidable(rec);

  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5" data-testid="rec-detail">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-xs text-dim">{rec.id.toUpperCase()}</Mono>
            <RecStatusBadge status={rec.status} />
          </div>
          <h2 className="mt-1 text-lg font-semibold text-text">
            {rec.summary}
          </h2>
          <p className="mt-1 text-xs text-dim">
            {t('detail.created', {relative: fmt.ago(rec.createdAt)})}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 text-right">
          <p className="text-xs text-muted">
            {t('detail.confidence')}{' '}
            <span className="num text-xl font-semibold text-cyan">
              {fmt.number(rec.confidence, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </p>
          <RankedByBadge rankedBy={rec.rankedBy} model={rec.model} />
          <p className="flex items-center gap-1 text-xs text-muted">
            <Clock className="size-3.5" aria-hidden />
            {t('detail.expires')}:{' '}
            {t('detail.expiresAt', {
              relative: fmt.ago(rec.expiresAt),
              absolute: fmt.dateTimeTz(rec.expiresAt, timeZone),
            })}
          </p>
        </div>
      </header>

      <div
        className="flex items-start gap-2.5 rounded-[12px] border border-cyan/30 bg-cyan/5 p-4 text-sm text-text"
        data-testid="rec-rationale"
      >
        <Sparkles
          className="mt-0.5 size-4 shrink-0 text-violet"
          aria-label={
            rec.rankedBy === 'ai'
              ? t('detail.summaryAi')
              : t('detail.summaryTemplate')
          }
        />
        <div className="min-w-0">
          <h3 className="sr-only">{t('rationale.title')}</h3>
          <p>{rec.rationale}</p>
          {rec.rankedBy === 'rules' && (
            <p className="mt-1.5 text-xs text-muted">
              {t('rankedBy.rulesHint')}
            </p>
          )}
        </div>
      </div>

      <Section title={t('candidates.title')}>
        <CandidatesTable rec={rec} model={model} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title={t('evidence.title')}>
          <EvidenceList rec={rec} model={model} timeZone={timeZone} />
        </Section>
        <Section title={t('risks.title')}>
          {rec.risks.length ? (
            <ul
              className="flex flex-col gap-2 text-sm"
              aria-label={t('risks.title')}
            >
              {rec.risks.map(r => (
                <li key={r} className="flex items-start gap-2">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-warn"
                    aria-hidden
                  />
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-dim">{t('risks.empty')}</p>
          )}
        </Section>
      </div>

      <ExecutionResult rec={rec} />

      {rec.decidedAt && (
        <p className="text-xs text-muted">
          {t('detail.decided', {
            who: t(`detail.decidedBy.${rec.decidedBy ?? 'owner'}`),
            at: fmt.dateTimeTz(rec.decidedAt, timeZone),
          })}
          {rec.rejectReason &&
            ` · ${t('detail.rejectReason', {reason: rec.rejectReason})}`}
        </p>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {decidable && (
            <>
              <Button variant="primary" onClick={() => setConfirmOpen(true)}>
                {t('confirm.button')}
              </Button>
              <Button variant="danger" onClick={() => setRejectOpen(true)}>
                {t('reject.button')}
              </Button>
            </>
          )}
          {rec.scenarioId && (
            <Button variant="outline" asChild>
              <Link to="/scenarios/$id" params={{id: rec.scenarioId}}>
                <FlaskConical aria-hidden />
                {t('detail.openScenario')}
              </Link>
            </Button>
          )}
        </div>
        {decidable && topType && (
          <p className="text-xs text-muted">
            {t('footerNote', {
              type: model.byName[topType]?.displayName ?? topType,
            })}
          </p>
        )}
      </footer>

      <ConfirmRecommendationDialog
        recommendation={rec}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      />
      <RejectRecommendationDialog
        recommendation={rec}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
      />
    </Card>
  );
}
