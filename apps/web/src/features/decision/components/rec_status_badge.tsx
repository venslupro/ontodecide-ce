/**
 * @fileoverview Recommendation status badge (icon + text + color).
 */

import type {RecStatus} from '@ontodecide/decision/contract';
import {useTranslation} from 'react-i18next';
import {StatusBadge} from '../../../shared/ui/badge';
import {recStatusLevel} from '../model';

/** Status badge: 待确认 / 已确认 / 已执行 / 已驳回 / 已过期 / 执行失败. */
export function RecStatusBadge({
  status,
  className,
}: {
  status: RecStatus;
  className?: string;
}) {
  const {t} = useTranslation('recommendations');
  return (
    <StatusBadge level={recStatusLevel(status)} className={className}>
      {t(`status.${status}`)}
    </StatusBadge>
  );
}
