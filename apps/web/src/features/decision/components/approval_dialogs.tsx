/**
 * @fileoverview Approval dialogs of a recommendation: "approve & execute"
 * confirmation listing every action and the external systems it writes back
 * to, and "reject" requiring a reason (1–500 chars).
 */

import {zodResolver} from '@hookform/resolvers/zod';
import type {RecommendedAction} from '@ontodecide/decision/contract';
import {rejectInputSchema} from '@ontodecide/decision/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {CloudOff, ExternalLink, ShieldCheck} from 'lucide-react';
import {useEffect} from 'react';
import {useForm} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import {Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogClose, DialogContent} from '../../../shared/ui/dialog';
import {Field, Textarea} from '../../../shared/ui/input';
import {useObjectTitle} from './object_link';
import {ParamsSummary} from './params_summary';

function ApproveRow({action}: {action: RecommendedAction}) {
  const {t, i18n} = useTranslation('recommendations');
  const {model} = useUiModel();
  const def = model.actions.find(a => a.apiName === action.actionType);
  const name = resolveText(
    action.displayName,
    i18n.language,
    def?.displayName ?? action.actionType,
  );
  const target = useObjectTitle(action.target);
  const writeback = def?.writeback ?? 'none';
  return (
    <li className="rounded-[10px] border border-line bg-panel-2/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-text">
          <span className="mr-1.5 text-dim num">#{action.rank}</span>
          {name}
          <span className="text-muted"> · {target}</span>
        </span>
        {writeback === 'webhook' ? (
          <Badge tone="orange">
            <ExternalLink aria-hidden />
            {t('approve.writeback.webhook')}
          </Badge>
        ) : (
          <Badge tone="neutral">
            <CloudOff aria-hidden />
            {t('approve.writeback.none')}
          </Badge>
        )}
      </div>
      <div className="mt-1 text-xs">
        <ParamsSummary
          actionType={action.actionType}
          params={action.params}
          links={false}
        />
      </div>
    </li>
  );
}

/** Confirmation dialog for approve & execute. */
export function ApproveDialog({
  open,
  onOpenChange,
  actions,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  actions: readonly RecommendedAction[];
  onConfirm(): void;
}) {
  const {t} = useTranslation('recommendations');
  // decision-engine executes only the rank-1 action(s); the others are
  // alternatives shown on the detail page.
  const sorted = actions.filter(a => a.rank === 1);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('approve.title')}
        description={t('approve.description', {count: sorted.length})}
        size="lg"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant="secondary"
              className="border-cyan/60 text-cyan"
              onClick={onConfirm}
            >
              <ShieldCheck aria-hidden />
              {t('approve.confirm')}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-xs font-medium text-muted">
          {t('approve.writebackTitle')}
        </p>
        <ul className="flex flex-col gap-2" aria-label={t('approve.listAria')}>
          {sorted.map(a => (
            <ApproveRow
              key={`${a.actionType}:${a.target}:${a.rank}`}
              action={a}
            />
          ))}
        </ul>
        <p className="mt-3 text-xs text-dim">{t('approve.auditHint')}</p>
      </DialogContent>
    </Dialog>
  );
}

/** Reject dialog: a reason (1–500 chars) is mandatory. */
export function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(reason: string): void;
}) {
  const {t} = useTranslation('recommendations');
  const form = useForm<{reason: string}>({
    resolver: zodResolver(rejectInputSchema),
    defaultValues: {reason: ''},
  });
  const reason = form.watch('reason') ?? '';
  const err = form.formState.errors.reason;
  useEffect(() => {
    if (!open) form.reset({reason: ''});
  }, [open, form]);

  const submit = form.handleSubmit(v => onConfirm(v.reason.trim() || v.reason));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('reject.title')}
        description={t('reject.description')}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button variant="danger" type="submit" form="reject-form">
              {t('reject.confirm')}
            </Button>
          </>
        }
      >
        <form id="reject-form" onSubmit={e => void submit(e)} noValidate>
          <Field
            label={t('reject.reason')}
            htmlFor="reject-reason"
            required
            error={
              err
                ? reason.length > 500
                  ? t('reject.tooLong')
                  : t('reject.required')
                : undefined
            }
            hint={t('reject.counter', {count: reason.length})}
          >
            <Textarea
              id="reject-reason"
              rows={4}
              aria-invalid={!!err || undefined}
              aria-describedby={err ? 'reject-reason-error' : undefined}
              placeholder={t('reject.placeholder')}
              {...form.register('reason', {
                setValueAs: (v: string) => v.trim(),
              })}
            />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
