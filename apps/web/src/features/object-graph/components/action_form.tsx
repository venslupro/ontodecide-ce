/**
 * @fileoverview Action parameter form generated from the action's ParamDefs:
 * inputs come from the renderer registry, validation from a dynamically
 * built zod schema, defaults from `defaultValue`, objectRef candidates from
 * the parameter's `suggest` Object Set. Submits with If-Match (object
 * version) and maps 409 / 412 / 422 to the documented UX (前端详细设计 表 8).
 */

import {zodResolver} from '@hookform/resolvers/zod';
import type {ActionResult} from '@ontodecide/object-graph/contract';
import type {ObjectSetDef, Rid} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {
  AlertOctagon,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import {useMemo, useState} from 'react';
import {Controller, useForm, type Resolver} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import type {UiActionType} from '../../../entities/schema/model';
import {getRenderer} from '../../../entities/renderers/registry';
import {errorMessage} from '../../../shared/api/error_message';
import {useOnline} from '../../../shared/lib/hooks';
import {track} from '../../../shared/lib/telemetry';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';
import {Field} from '../../../shared/ui/input';
import {toast} from '../../../shared/ui/toast';
import {useApplyAction, useParamSuggestions} from '../api';
import {
  classifyActionError,
  cleanParams,
  paramDefaults,
  paramsSchema,
  type ActionErrorView,
} from '../model';

/** Action form props. */
export interface ActionFormProps {
  action: UiActionType;
  /** Target object (RID + current version for If-Match). */
  target: {rid: Rid; version?: number; title?: string};
  /** Called after a successful execution. */
  onDone?(result: ActionResult): void;
  onCancel?(): void;
  /**
   * Refetches the target after a 412 and resolves to its new version; the
   * form keeps its values and retries with that version.
   */
  onRefreshTarget?(): Promise<number | undefined>;
  /** Links an execution to an approved recommendation. */
  recommendationId?: string;
}

/** Form generated from an action type's parameters. */
export function ActionForm({
  action,
  target,
  onDone,
  onCancel,
  onRefreshTarget,
  recommendationId,
}: ActionFormProps) {
  const {t} = useTranslation('objects');
  const online = useOnline();
  const apply = useApplyAction();
  const [err, setErr] = useState<ActionErrorView | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const formId = `action-${action.apiName}`;

  const schema = useMemo(
    () =>
      paramsSchema(action.parameters, {
        required: t('action.required'),
        number: t('action.number'),
        integer: t('action.integer'),
      }),
    [action.parameters, t],
  );
  const form = useForm<Record<string, unknown>>({
    defaultValues: paramDefaults(action.parameters),
    resolver: zodResolver(schema) as unknown as Resolver<
      Record<string, unknown>
    >,
  });

  const suggestDefs = useMemo(
    () =>
      action.parameters
        .filter(p => p.suggest)
        .map(p => {
          const s = p.suggest!;
          const def: ObjectSetDef = {
            objectType: s.objectType,
            ...(s.filter ? {filter: s.filter} : {}),
            orderBy: [s.orderBy],
          };
          return {key: p.apiName, def};
        }),
    [action.parameters],
  );
  const suggestions = useParamSuggestions(suggestDefs, target.rid);

  const submit = async (
    values: Record<string, unknown>,
    version = target.version,
  ) => {
    setErr(null);
    track('action_apply', action.targetType);
    try {
      const r = await apply.mutateAsync({
        actionType: action.apiName,
        target: target.rid,
        params: cleanParams(values),
        version,
        recommendationId,
      });
      toast.success(t('action.success', {name: action.displayName}));
      onDone?.(r);
    } catch (e) {
      const v = classifyActionError(e);
      if (v.kind === 'conflict') setConflictOpen(true);
      else setErr(v);
    }
  };

  const refreshAndRetry = async () => {
    setRefreshing(true);
    try {
      const version = onRefreshTarget
        ? await onRefreshTarget()
        : target.version;
      setConflictOpen(false);
      await submit(form.getValues(), version);
    } finally {
      setRefreshing(false);
    }
  };

  const errors = form.formState.errors;

  return (
    <form
      id={formId}
      noValidate
      aria-label={action.displayName}
      onSubmit={form.handleSubmit(v => submit(v))}
      className="flex flex-col gap-4"
    >
      {action.description && (
        <p className="text-sm text-muted">{action.description}</p>
      )}

      {action.requiresApproval && (
        <div className="flex items-start gap-2 rounded-lg border border-violet/40 bg-violet/10 px-3 py-2 text-xs text-text">
          <Workflow
            className="mt-0.5 size-4 shrink-0 text-violet"
            aria-hidden
          />
          <span>{t('action.requiresApproval')}</span>
        </div>
      )}

      {action.parameters.length === 0 && (
        <p className="text-sm text-muted">{t('action.noParams')}</p>
      )}

      {action.parameters.map(p => {
        const id = `${formId}-${p.apiName}`;
        const error = errors[p.apiName]?.message;
        const renderProp = {
          apiName: p.apiName,
          displayName: p.displayName,
          dataType: p.dataType,
          required: p.required,
        };
        return (
          <Field
            key={p.apiName}
            label={p.displayName}
            htmlFor={id}
            required={p.required}
            error={typeof error === 'string' ? error : undefined}
            hint={p.suggest ? t('action.suggestHint') : undefined}
          >
            <Controller
              control={form.control}
              name={p.apiName}
              render={({field}) => (
                <>
                  {getRenderer(p.dataType).input(renderProp, field, {
                    id,
                    invalid: !!error,
                    disabled: apply.isPending,
                    suggestions: suggestions[p.apiName],
                  })}
                </>
              )}
            />
          </Field>
        );
      })}

      {action.preconditions.length > 0 && (
        <div className="rounded-lg border border-line bg-panel-2/60 px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <ListChecks className="size-3.5" aria-hidden />
            {t('action.preconditions')}
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
            {action.preconditions.map(pc => (
              <li key={pc}>{pc}</li>
            ))}
          </ul>
        </div>
      )}

      {err && <ActionErrorBox err={err} />}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        {!online && (
          <span className="mr-auto text-xs text-warn">
            {t('action.offline')}
          </span>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('common:actions.cancel')}
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          loading={apply.isPending}
          disabled={!online}
        >
          <ShieldCheck aria-hidden />
          {action.requiresApproval
            ? t('action.submitForApproval')
            : t('action.execute')}
        </Button>
      </div>

      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent
          size="sm"
          title={t('action.conflictTitle')}
          description={t('action.conflictBody')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConflictOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                onClick={() => void refreshAndRetry()}
                loading={refreshing}
              >
                <RefreshCw aria-hidden />
                {t('action.refreshRetry')}
              </Button>
            </>
          }
        />
      </Dialog>
    </form>
  );
}

function ActionErrorBox({err}: {err: ActionErrorView}) {
  const {t} = useTranslation('objects');
  const box =
    'rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-text';
  if (err.kind === 'approval') {
    return (
      <div
        role="alert"
        className="rounded-lg border border-violet/40 bg-violet/10 px-3 py-2 text-sm text-text"
      >
        <p className="flex items-center gap-1.5">
          <Workflow className="size-4 shrink-0 text-violet" aria-hidden />
          {t(`common:errors.${err.code}`)}
        </p>
        {err.recommendationId ? (
          <Link
            to="/recommendations/$id"
            params={{id: err.recommendationId}}
            className="mt-1 inline-block text-xs font-medium text-cyan hover:underline"
          >
            {t('action.openRecommendation')}
          </Link>
        ) : (
          <Link
            to="/recommendations"
            className="mt-1 inline-block text-xs font-medium text-cyan hover:underline"
          >
            {t('action.openRecommendations')}
          </Link>
        )}
      </div>
    );
  }
  if (err.kind === 'precondition') {
    return (
      <div role="alert" className={box}>
        <p className="flex items-center gap-1.5 font-medium text-crit">
          <AlertOctagon className="size-4 shrink-0" aria-hidden />
          {t('action.unmetTitle')}
        </p>
        {err.unmet.length > 0 && (
          <ul
            className="mt-1 list-disc space-y-0.5 pl-6 text-xs"
            aria-label={t('action.unmetTitle')}
          >
            {err.unmet.map(u => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (err.kind === 'other') {
    return (
      <div role="alert" className={box}>
        <p className="flex items-center gap-1.5">
          <AlertOctagon className="size-4 shrink-0 text-crit" aria-hidden />
          <ErrorText error={err.error} />
        </p>
      </div>
    );
  }
  return null;
}

function ErrorText({error}: {error: unknown}) {
  const {t} = useTranslation('objects');
  return <>{errorMessage(error, t)}</>;
}

/** Action form inside a modal dialog. */
export function ActionDialog({
  open,
  onOpenChange,
  ...props
}: ActionFormProps & {open: boolean; onOpenChange(open: boolean): void}) {
  const {t} = useTranslation('objects');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        title={props.action.displayName}
        description={
          props.target.title
            ? t('action.dialogTarget', {title: props.target.title})
            : undefined
        }
      >
        {open && (
          <ActionForm
            {...props}
            onCancel={() => onOpenChange(false)}
            onDone={r => {
              props.onDone?.(r);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
