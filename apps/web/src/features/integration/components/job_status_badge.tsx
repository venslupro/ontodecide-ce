/**
 * @fileoverview Import job status badge (icon + text + colour).
 */

import type {JobStatus} from '@ontodecide/integration/contract';
import {useTranslation} from 'react-i18next';
import {StatusBadge, type StatusLevel} from '../../../shared/ui/badge';

const LEVEL: Record<JobStatus, StatusLevel> = {
  RECEIVING: 'info',
  DONE: 'good',
  FAILED: 'crit',
};

/** Status badge of an import job. */
export function JobStatusBadge({status}: {status: JobStatus}) {
  const {t} = useTranslation('imports');
  return (
    <StatusBadge level={LEVEL[status] ?? 'info'}>
      {t(`status.${status}`, {defaultValue: status})}
    </StatusBadge>
  );
}
