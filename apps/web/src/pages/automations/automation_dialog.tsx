/**
 * @fileoverview Create / edit dialog of an automation rule (alert-only):
 * name zh / en, trigger (threshold | schedule every n hours), object type →
 * AND / OR condition builder, severity, cooldown and enabled. The only
 * effect is 「产生告警」 (read-only). Saving is disabled with the reason when
 * it would create a 4th scheduled rule or the interval is outside 1..24 h.
 * 412 opens the conflict dialog; 400 VALIDATION_FAILED is shown inline.
 */

import type {
  AutomationDef,
  AutomationDto,
  Severity,
} from '@ontodecide/situation/contract';
import {CE_LIMITS} from '@ontodecide/shared-kernel';
import {useQueryClient} from '@tanstack/react-query';
import {Bell, Lock} from 'lucide-react';
import {useId, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FilterBuilder} from '../../entities/schema/filter_builder';
import {newGroup} from '../../entities/schema/filter_model';
import {useUiModel} from '../../entities/schema/api';
import {ConflictDialog} from '../../features/object-graph/components/conflict_dialog';
import {
  situationKeys,
  useCreateAutomation,
  useUpdateAutomation,
} from '../../features/situation/api';
import {apiRequest} from '../../shared/api/client';
import {errorMessage} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {Button} from '../../shared/ui/button';
import {DialogContent} from '../../shared/ui/dialog';
import {Field, Input} from '../../shared/ui/input';
import {NativeSelect} from '../../shared/ui/select';
import {Switch} from '../../shared/ui/switch';
import {toast} from '../../shared/ui/toast';
import {
  type AutomationForm,
  emptyForm,
  type FormErrors,
  formFromDto,
  MAX_COOLDOWN,
  MAX_SCHEDULE_HOURS,
  propMap,
  saveBlockReason,
  scheduledCount,
  SEVERITIES,
  toDef,
  validateForm,
} from './automation_model';

/** Dialog props. */
export interface AutomationDialogProps {
  /** Edited rule; undefined creates a new one. */
  automation?: AutomationDto;
  /** All rules of the workspace (for the scheduled-rule limit). */
  list: readonly AutomationDto[];
  onDone(): void;
}

function serverFieldErrors(err: unknown): string | null {
  if (!isApiError(err, 'VALIDATION_FAILED')) return null;
  const list = err.extras.errors;
  if (Array.isArray(list) && list.length) {
    return list
      .map(e => {
        const r = (e ?? {}) as {path?: unknown; message?: unknown};
        return [r.path, r.message]
          .filter(x => typeof x === 'string' && x)
          .join(': ');
      })
      .join('; ');
  }
  return err.detail ?? '';
}

/** Dialog body (render inside a `Dialog`; remount per open to reset). */
export function AutomationDialog({
  automation,
  list,
  onDone,
}: AutomationDialogProps) {
  const {t} = useTranslation('automations');
  const id = useId();
  const qc = useQueryClient();
  const {model} = useUiModel();
  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const [base, setBase] = useState<AutomationDto | undefined>(automation);
  const [form, setForm] = useState<AutomationForm>(() =>
    automation ? formFromDto(automation) : emptyForm(model.types[0]?.apiName),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [otherError, setOtherError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<AutomationDef | null>(null);

  const type = model.byName[form.objectType];
  const props = useMemo(() => propMap(type), [type]);
  const block = saveBlockReason(form, list, base?.id);
  const pending = create.isPending || update.isPending;
  const set = (patch: Partial<AutomationForm>) =>
    setForm(f => ({...f, ...patch}));

  const onSave = () => {
    setServerError(null);
    setOtherError(null);
    const r = validateForm(form, props);
    setErrors(r.errors);
    if (!r.def) return;
    const def = r.def;
    const handlers = {
      onSuccess: () => {
        toast.success(base ? t('toast.updated') : t('toast.created'));
        onDone();
      },
      onError: (e: unknown) => {
        if (isApiError(e, 'PRECONDITION_FAILED') && e.status === 412) {
          setConflict(def);
          return;
        }
        const se = serverFieldErrors(e);
        if (se !== null) setServerError(se);
        else setOtherError(e);
      },
    };
    if (base)
      update.mutate({id: base.id, def, version: base.version}, handlers);
    else create.mutate(def, handlers);
  };

  const loadFresh = async (): Promise<AutomationDto | undefined> => {
    if (!base) return undefined;
    const res = await apiRequest<AutomationDto>(
      `/automations/${encodeURIComponent(base.id)}`,
    );
    return {...res.data, version: res.version ?? res.data.version};
  };

  const scheduled =
    scheduledCount(list, base?.id) + (form.trigger === 'schedule' ? 1 : 0);

  return (
    <>
      <DialogContent
        size="xl"
        title={base ? t('dialog.editTitle') : t('dialog.createTitle')}
        description={t('dialog.description')}
        footer={
          <>
            {block && (
              <p
                role="status"
                data-testid="save-block-reason"
                className="mr-auto flex items-center gap-1.5 text-xs text-warn"
              >
                <Lock className="size-3.5" aria-hidden />
                {t(`block.${block}`, {
                  max: CE_LIMITS.maxScheduledAutomations,
                  min: CE_LIMITS.minScheduleHours,
                  maxHours: MAX_SCHEDULE_HOURS,
                })}
              </p>
            )}
            <Button variant="ghost" onClick={onDone}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={!!block}
              onClick={onSave}
            >
              {t('actions.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={t('form.nameZh')}
              htmlFor={`${id}-zh`}
              required
              error={errors.nameZh && t(`form.error.${errors.nameZh}`)}
            >
              <Input
                id={`${id}-zh`}
                value={form.nameZh}
                aria-invalid={!!errors.nameZh}
                onChange={e => set({nameZh: e.target.value})}
              />
            </Field>
            <Field
              label={t('form.nameEn')}
              htmlFor={`${id}-en`}
              hint={t('form.nameEnHint')}
            >
              <Input
                id={`${id}-en`}
                value={form.nameEn}
                onChange={e => set({nameEn: e.target.value})}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t('form.trigger')} htmlFor={`${id}-trigger`}>
              <NativeSelect
                id={`${id}-trigger`}
                value={form.trigger}
                options={[
                  {value: 'threshold', label: t('trigger.threshold')},
                  {value: 'schedule', label: t('trigger.schedule')},
                ]}
                onChange={e =>
                  set({trigger: e.target.value as AutomationForm['trigger']})
                }
              />
            </Field>
            {form.trigger === 'schedule' && (
              <Field
                label={t('form.everyHours')}
                htmlFor={`${id}-hours`}
                hint={t('form.everyHoursHint', {
                  used: scheduled,
                  max: CE_LIMITS.maxScheduledAutomations,
                })}
              >
                <Input
                  id={`${id}-hours`}
                  type="number"
                  min={CE_LIMITS.minScheduleHours}
                  max={MAX_SCHEDULE_HOURS}
                  step={1}
                  className="num"
                  aria-invalid={
                    block === 'minInterval' ||
                    block === 'maxInterval' ||
                    block === 'intervalInteger'
                  }
                  value={form.everyHours}
                  onChange={e => set({everyHours: e.target.value})}
                />
              </Field>
            )}
            <Field
              label={t('form.objectType')}
              htmlFor={`${id}-type`}
              required
              error={errors.objectType && t(`form.error.${errors.objectType}`)}
            >
              <NativeSelect
                id={`${id}-type`}
                value={form.objectType}
                placeholder={t('form.chooseType')}
                options={model.types.map(x => ({
                  value: x.apiName,
                  label: x.displayName,
                }))}
                onChange={e =>
                  set({objectType: e.target.value, condition: newGroup('and')})
                }
              />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
            <legend className="px-1 text-xs font-semibold text-muted">
              {t('form.condition')}
            </legend>
            {type ? (
              <FilterBuilder
                label={t('form.condition')}
                value={form.condition}
                properties={type.properties}
                onChange={c => set({condition: c})}
              />
            ) : (
              <p className="text-xs text-dim">{t('form.chooseTypeFirst')}</p>
            )}
            {errors.condition && (
              <p role="alert" className="text-xs text-crit">
                {t(`form.error.${errors.condition}`)}
              </p>
            )}
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t('form.severity')} htmlFor={`${id}-sev`}>
              <NativeSelect
                id={`${id}-sev`}
                value={form.severity}
                options={SEVERITIES.map(s => ({
                  value: s,
                  label: t(`severity.${s}`),
                }))}
                onChange={e => set({severity: e.target.value as Severity})}
              />
            </Field>
            <Field
              label={t('form.cooldown')}
              htmlFor={`${id}-cd`}
              hint={t('form.cooldownHint', {max: MAX_COOLDOWN})}
              error={
                errors.cooldownSec &&
                t(`form.error.${errors.cooldownSec}`, {max: MAX_COOLDOWN})
              }
            >
              <Input
                id={`${id}-cd`}
                type="number"
                min={0}
                max={MAX_COOLDOWN}
                step={60}
                className="num"
                aria-invalid={!!errors.cooldownSec}
                value={form.cooldownSec}
                onChange={e => set({cooldownSec: e.target.value})}
              />
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-text">
                <Switch
                  checked={form.enabled}
                  aria-label={t('form.enabled')}
                  onCheckedChange={v => set({enabled: v})}
                />
                {t('form.enabled')}
              </label>
            </div>
          </div>

          <div
            data-testid="effect-row"
            className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-panel-2 px-3 py-2.5"
          >
            <span className="text-xs font-semibold text-muted">
              {t('form.effect')}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue/40 bg-blue/10 px-2 py-0.5 text-xs text-blue">
              <Bell className="size-3" aria-hidden />
              {t('effect.alert')}
            </span>
            <span className="text-xs text-dim">{t('effect.note')}</span>
          </div>

          {(serverError !== null || !!errors.root || !!otherError) && (
            <p role="alert" className="text-sm text-crit">
              {serverError !== null
                ? t('form.error.server', {detail: serverError})
                : errors.root
                  ? t('form.error.server', {detail: errors.root})
                  : errorMessage(otherError, t)}
            </p>
          )}
        </div>
      </DialogContent>

      <ConflictDialog
        open={!!conflict}
        onOpenChange={o => !o && setConflict(null)}
        mine={
          (conflict ?? toDef(form, props)) as unknown as Record<string, unknown>
        }
        loadTheirs={async () => {
          const fresh = await loadFresh();
          if (!fresh) return undefined;
          const {
            id: _i,
            version: _v,
            nextRunAt: _n,
            lastFiredAt: _l,
            ...def
          } = fresh;
          return def as unknown as Record<string, unknown>;
        }}
        onRefresh={() => {
          void qc.invalidateQueries({queryKey: situationKeys.automations()});
          void loadFresh().then(fresh => {
            if (!fresh) return;
            setBase(fresh);
            setForm(formFromDto(fresh));
            setErrors({});
          });
        }}
      />
    </>
  );
}
