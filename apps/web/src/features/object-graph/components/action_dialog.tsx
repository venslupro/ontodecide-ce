/**
 * @fileoverview Execute-action dialog: parameter form rendered from the
 * action type (renderer registry per DataType), `Idempotency-Key` created
 * when the dialog opens and reused for retries, `If-Match` = the object
 * version. 412 → conflict dialog; 422 unmet preconditions inline; 429
 * RATE_LIMITED → the execute button counts down Retry-After.
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import {useEffect, useMemo, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {getRenderer} from '../../../entities/renderers/registry';
import type {UiActionType} from '../../../entities/schema/model';
import {idempotencyKey} from '../../../shared/api/client';
import {errorMessage} from '../../../shared/api/error_message';
import {isApiError} from '../../../shared/api/errors';
import {useRetryAfter} from '../../../shared/api/rate_limit';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';
import {Field} from '../../../shared/ui/input';
import {toast} from '../../../shared/ui/toast';
import {useExecuteAction} from '../api';
import {cleanParams, missingParams, paramDefaults} from '../model';

/** Execute-action dialog. */
export function ActionDialog({
  action,
  object,
  open,
  onOpenChange,
  onConflict,
}: {
  action: UiActionType | undefined;
  object: ObjectDto;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called on 412 (the object changed since it was loaded). */
  onConflict(): void;
}) {
  const {t} = useTranslation('objects');
  const exec = useExecuteAction();
  // A new key per opening of the dialog; network retries reuse it.
  const [key, setKey] = useState(idempotencyKey);
  const defaults = useMemo(
    () => (action ? paramDefaults(action) : {}),
    [action],
  );
  const form = useForm<Record<string, unknown>>({defaultValues: defaults});
  const [missing, setMissing] = useState<string[]>([]);
  const limit = useRetryAfter(`action:${action?.apiName ?? ''}`);
  useEffect(() => {
    if (open) {
      setKey(idempotencyKey());
      form.reset(defaults);
      setMissing([]);
      exec.reset();
    }
  }, [open, action?.apiName]);

  if (!action) return null;
  const unmet = isApiError(exec.error, 'VALIDATION_FAILED')
    ? (exec.error.extras.unmet as string[] | undefined)
    : undefined;

  const submit = form.handleSubmit(values => {
    const miss = missingParams(action.parameters, values);
    setMissing(miss);
    if (miss.length || limit.limited) return;
    exec.mutate(
      {
        actionType: action.apiName,
        target: object.rid,
        params: cleanParams(values),
        version: object.version,
        idempotencyKey: key,
      },
      {
        onSuccess: r => {
          toast.success(
            r.replayed
              ? t('action.replayed')
              : t('action.done', {action: action.displayName}),
          );
          onOpenChange(false);
        },
        onError: e => {
          limit.trap(e);
          if (isApiError(e, 'PRECONDITION_FAILED')) {
            onOpenChange(false);
            onConflict();
          }
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('action.title', {action: action.displayName})}
        description={t('action.description', {title: object.title})}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={exec.isPending}
              disabled={limit.limited}
              onClick={() => void submit()}
            >
              {limit.limited
                ? t('common:rateLimit.retryIn', {seconds: limit.seconds})
                : t('action.execute')}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          {action.parameters.length === 0 && (
            <p className="text-sm text-muted">{t('action.noParams')}</p>
          )}
          {action.parameters.map(p => {
            const id = `param-${p.apiName}`;
            return (
              <Field
                key={p.apiName}
                label={p.displayName}
                htmlFor={id}
                required={p.required}
                error={
                  missing.includes(p.apiName) ? t('action.required') : undefined
                }
              >
                <Controller
                  control={form.control}
                  name={p.apiName}
                  render={({field}) =>
                    getRenderer(p.dataType).input(p, field, {
                      id,
                      invalid: missing.includes(p.apiName),
                    }) as React.ReactElement
                  }
                />
              </Field>
            );
          })}
          <p className="text-xs text-dim">{t('action.audit')}</p>
          {exec.error && !isApiError(exec.error, 'PRECONDITION_FAILED') ? (
            <div role="alert" className="text-xs text-crit">
              {unmet?.length ? unmet.join('；') : errorMessage(exec.error, t)}
            </div>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
