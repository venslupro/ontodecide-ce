/**
 * @fileoverview 「确认并执行」 dialog for a recommendation (Owner decision).
 * Explains that the top-ranked action updates objects inside the workspace
 * and is written to the audit log (never written back to external systems).
 * The Idempotency-Key is generated when the dialog opens and reused for
 * every retry of that dialog (前端详细设计 幂等); a 409 means the
 * recommendation was already handled — the data is refetched. Used by the
 * recommendation center, the cockpit and the Object View.
 */

import type {Candidate, RecommendationDto} from '@ontodecide/decision/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {useQueryClient} from '@tanstack/react-query';
import {AlertTriangle, ShieldCheck} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {idempotencyKey} from '../../../shared/api/client';
import {errorMessage} from '../../../shared/api/error_message';
import {isApiError} from '../../../shared/api/errors';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';
import {toast} from '../../../shared/ui/toast';
import {decisionKeys, useDecide} from '../api';
import {topCandidate} from '../model';

/** Minimal recommendation data the dialog needs (e.g. a cockpit item). */
export interface PendingRecSummary {
  id: string;
  summary: string;
  candidates?: Candidate[];
  ranking?: string[];
}

/** Props of {@link ConfirmRecommendationDialog}. */
export interface ConfirmRecommendationDialogProps {
  recommendation: RecommendationDto | PendingRecSummary;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called with the decided recommendation after success. */
  onDone?(rec: RecommendationDto): void;
}

/** Inline error shown inside a decision dialog. */
export function DecisionError({error}: {error: unknown}) {
  const {t} = useTranslation('recommendations');
  if (!error) return null;
  const text = isApiError(error, 'CONFLICT')
    ? t('errors.alreadyHandled')
    : errorMessage(error, t);
  return (
    <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-crit">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

function ConfirmContent({
  recommendation: rec,
  onOpenChange,
  onDone,
}: Omit<ConfirmRecommendationDialogProps, 'open'>) {
  const {t, i18n} = useTranslation('recommendations');
  const qc = useQueryClient();
  // One key per opening of the dialog; retries reuse it.
  const [key] = useState(() => idempotencyKey());
  const [error, setError] = useState<unknown>(null);
  const decide = useDecide();
  const top = topCandidate(rec);
  const conflict = isApiError(error, 'CONFLICT');

  const submit = () => {
    setError(null);
    decide.mutate(
      {id: rec.id, decision: 'confirm', idempotencyKey: key},
      {
        onSuccess: r => {
          toast.success(t('confirm.done'));
          onDone?.(r);
          onOpenChange(false);
        },
        onError: e => {
          setError(e);
          if (isApiError(e, 'CONFLICT'))
            void qc.invalidateQueries({queryKey: decisionKeys.rec(rec.id)});
        },
      },
    );
  };

  return (
    <DialogContent
      title={t('confirm.title')}
      description={rec.summary}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          {!conflict && (
            <Button
              variant="primary"
              loading={decide.isPending}
              disabled={decide.isPending}
              onClick={submit}
            >
              {error ? t('confirm.retry') : t('confirm.submit')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex items-start gap-2.5 text-sm text-text">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
        <div className="space-y-1.5">
          <p>
            {top
              ? t('confirm.body', {
                  action: resolveText(
                    top.displayName,
                    i18n.language,
                    top.actionType,
                  ),
                  target: top.targetTitle,
                })
              : t('confirm.generic')}
          </p>
          <p className="text-muted">{t('confirm.noExternal')}</p>
        </div>
      </div>
      <DecisionError error={error} />
    </DialogContent>
  );
}

/** Confirm-and-execute dialog. */
export function ConfirmRecommendationDialog(
  props: ConfirmRecommendationDialogProps,
) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ConfirmContent {...props} />}
    </Dialog>
  );
}
