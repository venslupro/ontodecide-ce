/**
 * @fileoverview "Generate AI recommendation" button with the caller's
 * remaining daily LLM quota, a disabled state at 0 and a RATE_LIMITED
 * countdown. Navigates to the (polling) recommendation detail on success.
 */

import {useNavigate} from '@tanstack/react-router';
import {Sparkles} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../../../shared/api/error_message';
import {isApiError} from '../../../shared/api/errors';
import {useCountdown, useOnline} from '../../../shared/lib/hooks';
import {track} from '../../../shared/lib/telemetry';
import {Button} from '../../../shared/ui/button';
import {toast} from '../../../shared/ui/toast';
import {useGenerateRecommendation, useLlmQuota} from '../api';

/** AI generation trigger. `blockedReason` disables it with an explanation. */
export function AiGenerateButton({
  scenarioId,
  focus,
  alertId,
  blockedReason,
  objectType,
}: {
  scenarioId?: string;
  focus?: string;
  alertId?: string;
  blockedReason?: string;
  objectType?: string;
}) {
  const {t, i18n} = useTranslation('scenarios');
  const navigate = useNavigate();
  const online = useOnline();
  const quota = useLlmQuota();
  const gen = useGenerateRecommendation();
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const wait = useCountdown(retryAt);
  const remaining = quota.data?.userRemaining;
  const exhausted = remaining !== undefined && remaining <= 0;
  const reason =
    blockedReason ??
    (!online
      ? t('ai.offline')
      : exhausted
        ? t('ai.exhausted')
        : wait > 0
          ? t('ai.rateLimited', {seconds: wait})
          : undefined);

  const run = () => {
    if (!focus) return;
    track('ai_generate', objectType);
    gen.mutate(
      {
        scenarioId,
        focus: focus as `ri.${string}.${string}.${string}`,
        alertId,
        locale: i18n.language,
      },
      {
        onSuccess: r =>
          void navigate({to: '/recommendations/$id', params: {id: r.jobId}}),
        onError: e => {
          if (isApiError(e, 'RATE_LIMITED'))
            setRetryAt(Date.now() + (e.retryAfter ?? 30) * 1000);
          toast.error(t('ai.failed'), errorMessage(e, t));
        },
      },
    );
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={run}
          loading={gen.isPending}
          disabled={!!reason || !focus}
          aria-describedby="ai-gen-hint"
          className="border-violet/50 text-violet hover:border-violet hover:text-violet"
        >
          <Sparkles aria-hidden />
          {t('ai.generate')}
        </Button>
        {remaining !== undefined && (
          <span
            className={
              exhausted ? 'text-xs text-crit num' : 'text-xs text-muted num'
            }
          >
            {t('common:ai.remaining', {count: Math.max(0, remaining)})}
          </span>
        )}
      </div>
      <p id="ai-gen-hint" className="text-xs text-dim">
        {reason ?? t('ai.hint')}
      </p>
    </div>
  );
}
