/**
 * @fileoverview Ranking source badge of a recommendation:
 * 「AI 排序（qwen3-30b-a3b）」 when Workers AI ranked it, 「规则排序」 when the
 * daily AI quota was used up or AI was unavailable (前端详细设计 表 10).
 */

import {ListOrdered, Sparkles} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../../shared/ui/badge';
import {modelShortName} from '../model';

/** Ranked-by badge; `showHint` also renders the explanation as text. */
export function RankedByBadge({
  rankedBy,
  model,
  showHint = false,
  className,
}: {
  rankedBy: 'ai' | 'rules';
  model?: string;
  showHint?: boolean;
  className?: string;
}) {
  const {t} = useTranslation('recommendations');
  const ai = rankedBy === 'ai';
  const hint = ai ? t('rankedBy.aiHint') : t('rankedBy.rulesHint');
  return (
    <span className={className}>
      <Badge tone={ai ? 'violet' : 'neutral'} title={hint}>
        {ai ? <Sparkles aria-hidden /> : <ListOrdered aria-hidden />}
        {ai
          ? t('rankedBy.ai', {model: modelShortName(model)})
          : t('rankedBy.rules')}
      </Badge>
      {showHint && <span className="ml-2 text-xs text-muted">{hint}</span>}
    </span>
  );
}
