/**
 * @fileoverview Recommendation status and model badges.
 */

import type {RecStatus} from '@ontodecide/decision/contract';
import {Cpu} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {AiBadge, Badge, StatusBadge} from '../../../shared/ui/badge';
import {recStatusLevel} from '../model';

/** Localized status badge (icon + text + color). */
export function RecStatusBadge({
  status,
  className,
}: {
  status: RecStatus;
  className?: string;
}) {
  const {t} = useTranslation('common');
  return (
    <StatusBadge level={recStatusLevel(status)} className={className}>
      {t(`recStatus.${status}`, {defaultValue: status})}
    </StatusBadge>
  );
}

/** `AiBadge` for LLM output, or a neutral "rules" badge for the rule-based fallback. */
export function RecSourceBadge({
  model,
  className,
}: {
  model: string;
  className?: string;
}) {
  const {t} = useTranslation('recommendations');
  if (model === 'rules') {
    return (
      <Badge tone="blue" className={className} title={t('rulesHint')}>
        <Cpu aria-hidden />
        {t('rulesBadge')}
      </Badge>
    );
  }
  return <AiBadge className={className} />;
}
