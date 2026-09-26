/**
 * @fileoverview KPI widget: one bound KPI or the responsive row of all KPIs.
 */

import type {KpiValue} from '@ontodecide/situation/contract';
import {Gauge} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {EmptyState} from '../../../shared/ui/empty_state';
import {KpiCard} from './kpi_card';

/** Renders KPI cards; `kpiId` selects one specific KPI. */
export function KpiRow({
  kpis,
  kpiId,
  className,
}: {
  kpis: readonly KpiValue[];
  kpiId?: string;
  className?: string;
}) {
  const {t} = useTranslation('cockpit');
  const list = kpiId ? kpis.filter(k => k.id === kpiId) : kpis;
  if (list.length === 0) {
    return (
      <section className={cn('glass', className)} aria-label={t('kpi.title')}>
        <EmptyState
          icon={<Gauge aria-hidden />}
          title={t('kpi.empty')}
          description={t('kpi.emptyHint')}
          className="py-6"
        />
      </section>
    );
  }
  if (kpiId)
    return <KpiCard kpi={list[0]} className={cn('h-full', className)} />;
  return (
    <section
      aria-label={t('kpi.title')}
      className={cn(
        'grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4',
        className,
      )}
    >
      {list.map(k => (
        <KpiCard key={k.id} kpi={k} />
      ))}
    </section>
  );
}
