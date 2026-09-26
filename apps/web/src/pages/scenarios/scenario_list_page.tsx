/**
 * @fileoverview Scenario list (情景推演): saved scenarios with their
 * perturbations, the risk level of the stored result and creation time.
 */

import type {Perturbation, ScenarioDto} from '@ontodecide/decision/contract';
import {parseRid} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {FlaskConical, Plus} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../entities/schema/api';
import {useScenarios} from '../../features/decision/api';
import {ObjectLink} from '../../features/decision/components/object_link';
import {riskLevelStatus} from '../../features/decision/model';
import {errorMessage} from '../../shared/api/error_message';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {DegradedBadge, StatusBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';

function PerturbationSummary({p}: {p: Perturbation}) {
  const {model} = useUiModel();
  const type = parseRid(p.rid)?.objectType;
  const prop = type
    ? model.byName[type]?.properties.find(x => x.apiName === p.property)
    : undefined;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <ObjectLink rid={p.rid} />
      <span className="text-muted">{prop?.displayName ?? p.property}</span>
      <span
        className={cn(
          'font-semibold num',
          p.change < 0 ? 'text-crit' : 'text-good',
        )}
      >
        {fmt.signedPercent(p.change, 0)}
      </span>
    </span>
  );
}

function Row({s}: {s: ScenarioDto}) {
  const {t} = useTranslation('scenarios');
  const extra = s.perturbations.length - 2;
  return (
    <Tr>
      <Td className="font-medium">
        <Link
          to="/scenarios/$id"
          params={{id: s.id}}
          className="text-text hover:text-cyan hover:underline"
        >
          {s.name || s.id}
        </Link>
      </Td>
      <Td className="text-sm">
        <ul className="flex flex-col gap-0.5">
          {s.perturbations.slice(0, 2).map((p, i) => (
            <li key={`${p.rid}:${p.property}:${i}`}>
              <PerturbationSummary p={p} />
            </li>
          ))}
          {extra > 0 && (
            <li className="text-xs text-dim">
              {t('list.more', {count: extra})}
            </li>
          )}
        </ul>
      </Td>
      <Td>
        {s.result ? (
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge level={riskLevelStatus(s.result.riskLevel)}>
              {t(`common:severity.${s.result.riskLevel}`)}
            </StatusBadge>
            {s.result.degraded && <DegradedBadge />}
          </span>
        ) : (
          <span className="text-xs text-dim">{t('list.notRun')}</span>
        )}
      </Td>
      <Td className="text-xs whitespace-nowrap text-muted">
        <time dateTime={s.createdAt} title={fmt.dateTime(s.createdAt)}>
          {fmt.ago(s.createdAt)}
        </time>
      </Td>
      <Td className="text-right">
        <Button asChild size="sm" variant="ghost">
          <Link
            to="/scenarios/$id"
            params={{id: s.id}}
            aria-label={t('list.openAria', {name: s.name || s.id})}
          >
            {t('common:actions.open')}
          </Link>
        </Button>
      </Td>
    </Tr>
  );
}

/** Scenario list page. */
export function ScenarioListPage() {
  const {t} = useTranslation('scenarios');
  const q = useScenarios();
  const items = [...(q.data ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          <Button asChild variant="primary">
            <Link to="/scenarios/$id" params={{id: 'new'}}>
              <Plus aria-hidden />
              {t('list.new')}
            </Link>
          </Button>
        }
      />
      <section
        className="glass overflow-hidden"
        aria-busy={q.isLoading || undefined}
      >
        {q.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.error ? (
          <ErrorView
            detail={errorMessage(q.error, t)}
            onRetry={() => void q.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FlaskConical aria-hidden />}
            title={t('list.empty')}
            description={t('list.emptyHint')}
            action={
              <Button asChild size="sm">
                <Link to="/scenarios/$id" params={{id: 'new'}}>
                  {t('list.new')}
                </Link>
              </Button>
            }
          />
        ) : (
          <Table aria-label={t('list.title')}>
            <THead>
              <Tr>
                <Th>{t('list.name')}</Th>
                <Th>{t('list.perturbations')}</Th>
                <Th>{t('list.risk')}</Th>
                <Th>{t('list.created')}</Th>
                <Th>
                  <span className="sr-only">{t('common:actions.open')}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {items.map(s => (
                <Row key={s.id} s={s} />
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  );
}
