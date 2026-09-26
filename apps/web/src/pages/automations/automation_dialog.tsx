/**
 * @fileoverview Create / edit dialog for an automation rule: name (zh / en),
 * trigger + object type, condition builder (shared FilterBuilder), effects
 * (alert / recommend with optional perturbation / approval-free action),
 * severity, cooldown and enabled. Saving always dry-runs first and asks for
 * confirmation with the expected number of firings.
 */

import {zodResolver} from '@hookform/resolvers/zod';
import type {
  AutomationDef,
  AutomationDto,
} from '@ontodecide/situation/contract';
import {Link} from '@tanstack/react-router';
import {FlaskConical, Info} from 'lucide-react';
import {type ReactNode, useMemo, useState} from 'react';
import {Controller, useForm, useWatch} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {FilterBuilder} from '../../entities/object_set/filter_builder';
import {newGroup} from '../../entities/object_set/filter_model';
import {useUiModel} from '../../entities/schema/api';
import {
  dryRunAutomation,
  useSaveAutomation,
} from '../../features/situation/api';
import {errorMessage} from '../../shared/api/error_message';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {useOnline} from '../../shared/lib/hooks';
import {Button} from '../../shared/ui/button';
import {DialogContent} from '../../shared/ui/dialog';
import {Checkbox, Field, Input, Label} from '../../shared/ui/input';
import {Mono} from '../../shared/ui/page_header';
import {NativeSelect} from '../../shared/ui/select';
import {Slider} from '../../shared/ui/slider';
import {Switch} from '../../shared/ui/switch';
import {toast} from '../../shared/ui/toast';
import {
  type AutomationFormValues,
  conditionProperties,
  conditionSummary,
  emptyForm,
  formFromDto,
  makeFormSchema,
  MAX_COOLDOWN,
  numericProperties,
  propMap,
  SEVERITIES,
  toDef,
  triggerSummary,
} from './automation_model';

type DryResult = {wouldFire: number; sample: string[]};

function Section({title, children}: {title: ReactNode; children: ReactNode}) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-line pt-4 first:border-0 first:pt-0">
      <legend className="mb-1 text-xs font-semibold tracking-wide text-dim uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function DryRunResult({result}: {result: DryResult}) {
  const {t} = useTranslation('cockpit');
  return (
    <div
      role="status"
      data-testid="dry-run-result"
      className={cn(
        'rounded-[10px] border px-3 py-2.5 text-sm',
        result.wouldFire > 0
          ? 'border-cyan/40 bg-cyan/10'
          : 'border-line-2 bg-panel-2',
      )}
    >
      <p className="flex items-center gap-2 font-medium text-text">
        <FlaskConical className="size-4 text-cyan" aria-hidden />
        {t('automations.dryRun.result', {count: result.wouldFire})}
      </p>
      {result.sample.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-dim">{t('automations.dryRun.sample')}</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {result.sample.slice(0, 10).map(rid => (
              <li key={rid}>
                <Link
                  to="/objects/rid/$rid"
                  params={{rid}}
                  className="hover:underline"
                >
                  <Mono className="text-cyan">{rid}</Mono>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-xs text-dim">{t('automations.dryRun.hint')}</p>
    </div>
  );
}

/** Dialog body (render inside a `Dialog`). Remount per open to reset. */
export function AutomationDialog({
  automation,
  onDone,
}: {
  automation?: AutomationDto;
  onDone(): void;
}) {
  const {t} = useTranslation('cockpit');
  const {model} = useUiModel();
  const online = useOnline();
  const save = useSaveAutomation();
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [dry, setDry] = useState<DryResult | null>(null);
  const [dryError, setDryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<AutomationDef | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const keptTrigger =
    automation?.trigger.kind === 'objectSetCount'
      ? automation.trigger
      : undefined;
  const keptAction = automation?.effects.find(e => e.kind === 'action');
  const keptParams =
    keptAction?.kind === 'action' ? keptAction.params : undefined;

  const form = useForm<AutomationFormValues>({
    defaultValues: automation ? formFromDto(automation) : emptyForm(),
    // Resolver is rebuilt on each render so it sees the current type's properties.
    resolver: (values, ctx, opts) => {
      const type = model.byName[values.objectType];
      return zodResolver(
        makeFormSchema(t, {props: propMap(type), keptTrigger}),
      )(values, ctx, opts as never);
    },
  });
  const {register, control, handleSubmit, setValue, formState} = form;
  const errors = formState.errors;
  const [objectType, triggerKind, recommend, perturb, action, perturbChange] =
    useWatch({
      control,
      name: [
        'objectType',
        'triggerKind',
        'recommend',
        'perturb',
        'action',
        'perturbChange',
      ],
    });
  const type = model.byName[objectType];
  const condProps = useMemo(() => conditionProperties(type), [type]);
  const numeric = useMemo(() => numericProperties(type), [type]);
  const freeActions = useMemo(
    () => (type?.actions ?? []).filter(a => !a.requiresApproval),
    [type],
  );

  const buildDef = (v: AutomationFormValues) =>
    toDef(v, {
      id: automation?.id,
      keptTrigger,
      props: propMap(model.byName[v.objectType]),
      keptParams,
    });

  const runDry = async (v: AutomationFormValues, thenConfirm: boolean) => {
    const def = buildDef(v);
    setRunning(true);
    setDryError(null);
    try {
      const r = await dryRunAutomation(def);
      setDry(r);
      if (thenConfirm) {
        setPending(def);
        setSaveError(null);
        setStep('confirm');
      }
    } catch (e) {
      setDry(null);
      setDryError(
        t('automations.dryRun.failed', {message: errorMessage(e, t)}),
      );
    } finally {
      setRunning(false);
    }
  };

  const onSave = handleSubmit(v => runDry(v, true));
  const onDryRun = handleSubmit(v => runDry(v, false));

  const confirm = async () => {
    if (!pending) return;
    setSaveError(null);
    try {
      await save.mutateAsync(pending);
      toast.success(t('automations.saved'));
      onDone();
    } catch (e) {
      setSaveError(errorMessage(e, t));
    }
  };

  const title = automation
    ? t('automations.dialog.editTitle')
    : t('automations.dialog.createTitle');

  if (step === 'confirm' && pending && dry) {
    return (
      <DialogContent
        size="lg"
        title={t('automations.dialog.confirmTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setStep('edit')}
              disabled={save.isPending}
            >
              {t('automations.dialog.back')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirm()}
              loading={save.isPending}
              disabled={!online}
            >
              {t('automations.dialog.confirmSave')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <DryRunResult result={dry} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-dim">{t('automations.col.name')}</dt>
            <dd className="text-text">{form.getValues('nameZh')}</dd>
            <dt className="text-dim">{t('automations.col.trigger')}</dt>
            <dd className="text-text">
              {triggerSummary(pending.trigger, model, t)}
            </dd>
            <dt className="text-dim">{t('automations.col.condition')}</dt>
            <dd className="text-text">
              {conditionSummary(pending.condition, type, t)}
            </dd>
            <dt className="text-dim">{t('automations.col.severity')}</dt>
            <dd className="text-text">
              {t(`common:severity.${pending.severity}`)}
            </dd>
          </dl>
          {saveError && (
            <p role="alert" className="text-sm text-crit">
              {saveError}
            </p>
          )}
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent
      size="lg"
      title={title}
      description={t('automations.dialog.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void onDryRun()}
            loading={running && step === 'edit'}
            disabled={!online}
          >
            <FlaskConical aria-hidden />
            {t('automations.dryRun.run')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void onSave()}
            disabled={!online || running}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void onSave();
        }}
      >
        <Section title={t('automations.form.basics')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('automations.form.nameZh')}
              htmlFor="auto-name-zh"
              required
              error={errors.nameZh?.message}
            >
              <Input
                id="auto-name-zh"
                aria-invalid={!!errors.nameZh}
                {...register('nameZh')}
              />
            </Field>
            <Field
              label={t('automations.form.nameEn')}
              htmlFor="auto-name-en"
              hint={t('automations.form.nameEnHint')}
            >
              <Input id="auto-name-en" {...register('nameEn')} />
            </Field>
          </div>
        </Section>

        <Section title={t('automations.form.triggerSection')}>
          {triggerKind === 'keep' ? (
            <p className="flex items-center gap-2 rounded-[10px] border border-line-2 bg-panel-2 px-3 py-2 text-xs text-muted">
              <Info className="size-4 shrink-0 text-blue" aria-hidden />
              {t('automations.form.unsupportedTrigger')}
              {automation &&
                ` (${triggerSummary(automation.trigger, model, t)})`}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('automations.form.objectType')}
                htmlFor="auto-type"
                required
                error={errors.objectType?.message}
              >
                <NativeSelect
                  id="auto-type"
                  aria-invalid={!!errors.objectType}
                  placeholder={t('automations.form.chooseType')}
                  options={model.types.map(o => ({
                    value: o.apiName,
                    label: o.displayName,
                  }))}
                  {...register('objectType', {
                    onChange: () => {
                      setValue('condition', newGroup('and'));
                      setValue('perturbProperty', '');
                      setValue('actionType', '');
                    },
                  })}
                />
              </Field>
              <Field
                label={t('automations.form.triggerKind')}
                htmlFor="auto-trigger"
                hint={t(`automations.triggerHint.${triggerKind}`)}
              >
                <NativeSelect
                  id="auto-trigger"
                  options={(['threshold', 'schedule'] as const).map(k => ({
                    value: k,
                    label: t(`automations.trigger.${k}`),
                  }))}
                  {...register('triggerKind')}
                />
              </Field>
            </div>
          )}
        </Section>

        <Section title={t('automations.form.condition')}>
          {type ? (
            <Controller
              control={control}
              name="condition"
              render={({field}) => (
                <FilterBuilder
                  label={t('automations.form.conditionLabel')}
                  value={field.value}
                  onChange={field.onChange}
                  properties={condProps}
                />
              )}
            />
          ) : (
            <p className="text-xs text-dim">
              {t('automations.form.conditionNeedsType')}
            </p>
          )}
        </Section>

        <Section title={t('automations.form.effects')}>
          {errors.alert?.message && (
            <p role="alert" className="text-xs text-crit">
              {errors.alert.message}
            </p>
          )}
          <div className="flex flex-col gap-3">
            <Controller
              control={control}
              name="alert"
              render={({field}) => (
                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="eff-alert"
                    checked={field.value}
                    onCheckedChange={v => field.onChange(v === true)}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="eff-alert" className="text-sm text-text">
                      {t('automations.effect.alert')}
                    </Label>
                    <p className="text-xs text-dim">
                      {t('automations.effectHint.alert')}
                    </p>
                  </div>
                </div>
              )}
            />
            <Controller
              control={control}
              name="recommend"
              render={({field}) => (
                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="eff-rec"
                    checked={field.value}
                    onCheckedChange={v => field.onChange(v === true)}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="eff-rec" className="text-sm text-text">
                      {t('automations.effect.recommend')}
                    </Label>
                    <p className="text-xs text-dim">
                      {t('automations.effectHint.recommend')}
                    </p>
                  </div>
                </div>
              )}
            />
            {recommend && (
              <div className="ml-6 flex flex-col gap-3 rounded-[10px] border border-line bg-panel-2/50 p-3">
                <Controller
                  control={control}
                  name="perturb"
                  render={({field}) => (
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        id="eff-perturb"
                        checked={field.value}
                        onCheckedChange={v => field.onChange(v === true)}
                      />
                      <Label
                        htmlFor="eff-perturb"
                        className="text-sm text-text"
                      >
                        {t('automations.form.perturbation')}
                      </Label>
                    </div>
                  )}
                />
                {perturb &&
                  (numeric.length === 0 ? (
                    <p className="text-xs text-dim">
                      {t('automations.form.noNumeric')}
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label={t('automations.form.perturbProperty')}
                        htmlFor="auto-perturb-prop"
                        error={errors.perturbProperty?.message}
                      >
                        <NativeSelect
                          id="auto-perturb-prop"
                          size="sm"
                          placeholder={t('automations.form.chooseProperty')}
                          options={numeric.map(p => ({
                            value: p.apiName,
                            label: p.displayName,
                          }))}
                          {...register('perturbProperty')}
                        />
                      </Field>
                      <Field
                        label={`${t('automations.form.perturbChange')}: ${fmt.signedPercent(perturbChange / 100, 0)}`}
                      >
                        <Controller
                          control={control}
                          name="perturbChange"
                          render={({field}) => (
                            <Slider
                              min={-100}
                              max={100}
                              step={5}
                              value={[field.value]}
                              onValueChange={([v]) => field.onChange(v)}
                              thumbLabel={t('automations.form.perturbChange')}
                              className="mt-1.5"
                            />
                          )}
                        />
                      </Field>
                    </div>
                  ))}
              </div>
            )}
            <Controller
              control={control}
              name="action"
              render={({field}) => (
                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="eff-action"
                    checked={field.value}
                    onCheckedChange={v => field.onChange(v === true)}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="eff-action" className="text-sm text-text">
                      {t('automations.effect.action')}
                    </Label>
                    <p className="text-xs text-dim">
                      {t('automations.effectHint.action')}
                    </p>
                  </div>
                </div>
              )}
            />
            {action && (
              <div className="ml-6">
                {freeActions.length === 0 ? (
                  <p className="text-xs text-dim">
                    {t('automations.form.noActions')}
                  </p>
                ) : (
                  <Field
                    label={t('automations.form.actionType')}
                    htmlFor="auto-action"
                    error={errors.actionType?.message}
                  >
                    <NativeSelect
                      id="auto-action"
                      size="sm"
                      className="sm:w-64"
                      placeholder={t('automations.form.chooseAction')}
                      options={freeActions.map(a => ({
                        value: a.apiName,
                        label: a.displayName,
                      }))}
                      {...register('actionType')}
                    />
                  </Field>
                )}
              </div>
            )}
          </div>
        </Section>

        <Section title={t('automations.col.severity')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label={t('automations.form.severity')}
              htmlFor="auto-severity"
            >
              <NativeSelect
                id="auto-severity"
                options={SEVERITIES.map(s => ({
                  value: s,
                  label: t(`common:severity.${s}`),
                }))}
                {...register('severity')}
              />
            </Field>
            <Field
              label={t('automations.form.cooldown')}
              htmlFor="auto-cooldown"
              hint={t('automations.form.cooldownHint')}
              error={errors.cooldownSec?.message}
            >
              <Input
                id="auto-cooldown"
                type="number"
                min={0}
                max={MAX_COOLDOWN}
                step={60}
                aria-invalid={!!errors.cooldownSec}
                {...register('cooldownSec', {valueAsNumber: true})}
              />
            </Field>
            <Controller
              control={control}
              name="enabled"
              render={({field}) => (
                <div className="flex items-center gap-2.5 sm:pt-6">
                  <Switch
                    id="auto-enabled"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Label htmlFor="auto-enabled" className="text-sm text-text">
                    {t('automations.form.enabled')}
                  </Label>
                </div>
              )}
            />
          </div>
        </Section>

        {errors.root?.message && (
          <p role="alert" className="text-sm text-crit">
            {errors.root.message}
          </p>
        )}
        {dryError && (
          <p role="alert" className="text-sm text-crit">
            {dryError}
          </p>
        )}
        {dry && step === 'edit' && <DryRunResult result={dry} />}
      </form>
    </DialogContent>
  );
}
