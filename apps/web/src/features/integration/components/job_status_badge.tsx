/**
 * @fileoverview Ingestion job status badge (icon + localized text + color).
 */

import type {JobStatus} from '@ontodecide/integration/contract';
import {Loader2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Badge, StatusBadge, type StatusLevel} from '../../../shared/ui/badge';

const LEVEL: Record<JobStatus, StatusLevel> = {
  Queued: 'info',
  Running: 'info',
  Succeeded: 'good',
  PartiallyFailed: 'warn',
  Failed: 'crit',
};

/** Status badge for a job (`common:jobStatus.*`). */
export function JobStatusBadge({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  const {t} = useTranslation('common');
  if (status === 'Running') {
    return (
      <Badge tone="cyan" className={className}>
        <Loader2 className="animate-spin" aria-hidden />
        {t('jobStatus.Running')}
      </Badge>
    );
  }
  return (
    <StatusBadge level={LEVEL[status] ?? 'info'} className={className}>
      {t(`jobStatus.${status}`, {defaultValue: status})}
    </StatusBadge>
  );
}

/** Tone for a 0..1 quality score. */
export function qualityTone(
  score: number | null | undefined,
): 'good' | 'warn' | 'crit' | 'neutral' {
  if (score === null || score === undefined || !Number.isFinite(score))
    return 'neutral';
  if (score >= 0.95) return 'good';
  if (score >= 0.8) return 'warn';
  return 'crit';
}
