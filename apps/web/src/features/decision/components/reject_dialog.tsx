/**
 * @fileoverview 「驳回」 dialog: a reason is required (≤ 500 characters). The
 * Idempotency-Key is generated when the dialog opens and reused for retries.
 */

import type {RecommendationDto} from '@ontodecide/decision/contract';
import {useQueryClient} from '@tanstack/react-query';
import {useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {idempotencyKey} from '../../../shared/api/client';
import {isApiError} from '../../../shared/api/errors';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';
import {Field, Textarea} from '../../../shared/ui/input';
import {toast} from '../../../shared/ui/toast';
import {decisionKeys, useDecide} from '../api';
import {DecisionError} from './confirm_dialog';

/** Maximum rejection reason length. */
export const REJECT_REASON_MAX = 500;

/** Props of {@link RejectRecommendationDialog}. */
export interface RejectRecommendationDialogProps {
  recommendation: Pick<RecommendationDto, 'id' | 'summary'>;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone?(rec: RecommendationDto): void;
}

function RejectContent({
  recommendation: rec,
  onOpenChange,
  onDone,
}: Omit<RejectRecommendationDialogProps, 'open'>) {
  const {t} = useTranslation('recommendations');
  const qc = useQueryClient();
  const id = useId();
  const [key] = useState(() => idempotencyKey());
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const decide = useDecide();
  const trimmed = reason.trim();
  const conflict = isApiError(error, 'CONFLICT');

  const submit = () => {
    setTouched(true);
    if (!trimmed) return;
    setError(null);
    decide.mutate(
      {id: rec.id, decision: 'reject', reason: trimmed, idempotencyKey: key},
      {
        onSuccess: r => {
          toast.success(t('reject.done'));
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
      title={t('reject.title')}
      description={rec.summary}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          {!conflict && (
            <Button
              variant="danger"
              loading={decide.isPending}
              disabled={decide.isPending || !trimmed}
              onClick={submit}
            >
              {t('reject.submit')}
            </Button>
          )}
        </>
      }
    >
      <Field
        label={t('reject.reason')}
        htmlFor={id}
        required
        error={touched && !trimmed ? t('reject.required') : undefined}
        hint={t('reject.counter', {
          count: reason.length,
          max: REJECT_REASON_MAX,
        })}
      >
        <Textarea
          id={id}
          value={reason}
          maxLength={REJECT_REASON_MAX}
          required
          aria-required
          placeholder={t('reject.placeholder')}
          onChange={e => setReason(e.target.value.slice(0, REJECT_REASON_MAX))}
          onBlur={() => setTouched(true)}
        />
      </Field>
      <DecisionError error={error} />
    </DialogContent>
  );
}

/** Reject dialog with a required reason. */
export function RejectRecommendationDialog(
  props: RejectRecommendationDialogProps,
) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <RejectContent {...props} />}
    </Dialog>
  );
}
