/**
 * @fileoverview Wizard step 4: record-level quality rules per property
 * (required / range / format / ref / freshness with argument editors and
 * onFail reject / clamp / defer), validated with `qualityRuleSchema` and the
 * client mirror of the server rule checks.
 */

import type {QualityRule} from '@ontodecide/integration/contract';
import {
  AlertTriangle,
  ListChecks,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {UiModel, UiObjectType} from '../../../entities/schema/model';
import {Button} from '../../../shared/ui/button';
import {Panel} from '../../../shared/ui/card';
import {EmptyState} from '../../../shared/ui/empty_state';
import {Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {newRule, ruleIssue, type RuleRow} from '../wizard';

const KINDS: QualityRule['kind'][] = [
  'required',
  'range',
  'format',
  'ref',
  'freshness',
];
const ON_FAIL: QualityRule['onFail'][] = ['reject', 'clamp', 'defer'];

/** Max rules per source (sourceDefSchema). */
export const MAX_RULES = 50;

/** Step 4 container. */
export function QualityStep({
  rules,
  onRules,
  type,
  model,
  showIssues,
}: {
  rules: RuleRow[];
  onRules: (r: RuleRow[]) => void;
  type?: UiObjectType;
  model: UiModel;
  showIssues: boolean;
}) {
  const {t} = useTranslation('sources');
  const props = type?.properties ?? [];
  const set = (id: string, patch: Partial<RuleRow>) =>
    onRules(
      rules.map(r => {
        if (r.id !== id) return r;
        const next = {...r, ...patch};
        // clamp only applies to range rules.
        if (next.kind !== 'range' && next.onFail === 'clamp')
          next.onFail = 'reject';
        return next;
      }),
    );

  const addRequired = () => {
    const existing = new Set(
      rules.filter(r => r.kind === 'required').map(r => r.prop),
    );
    const extra = props
      .filter(p => p.required && !existing.has(p.apiName))
      .map(p => newRule(p.apiName));
    onRules([...rules, ...extra].slice(0, MAX_RULES));
  };

  return (
    <Panel
      title={t('quality.title')}
      subtitle={t('quality.subtitle')}
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={addRequired}
            disabled={!type}
          >
            <ListChecks aria-hidden />
            {t('quality.fromSchema')}
          </Button>
          <Button
            size="sm"
            onClick={() =>
              onRules([...rules, newRule(props[0]?.apiName ?? '')])
            }
            disabled={rules.length >= MAX_RULES}
          >
            <Plus aria-hidden />
            {t('quality.add')}
          </Button>
        </>
      }
    >
      {rules.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck aria-hidden />}
          title={t('quality.empty')}
          description={t('quality.emptyHint')}
        />
      ) : (
        <Table aria-label={t('quality.title')}>
          <THead>
            <tr>
              <Th>{t('quality.cols.prop')}</Th>
              <Th>{t('quality.cols.kind')}</Th>
              <Th>{t('quality.cols.arg')}</Th>
              <Th>{t('quality.cols.onFail')}</Th>
              <Th className="w-8" />
            </tr>
          </THead>
          <TBody>
            {rules.map((r, i) => {
              const issue = ruleIssue(r);
              const n = i + 1;
              return (
                <Tr key={r.id} className="align-top">
                  <Td>
                    <NativeSelect
                      size="sm"
                      value={r.prop}
                      placeholder={t('quality.chooseProp')}
                      aria-label={t('quality.propLabel', {n})}
                      options={props.map(p => ({
                        value: p.apiName,
                        label: `${p.displayName} (${p.apiName})`,
                      }))}
                      onChange={e => set(r.id, {prop: e.target.value})}
                    />
                  </Td>
                  <Td>
                    <NativeSelect
                      size="sm"
                      value={r.kind}
                      aria-label={t('quality.kindLabel', {n})}
                      options={KINDS.map(k => ({
                        value: k,
                        label: t(`quality.kinds.${k}`),
                      }))}
                      onChange={e =>
                        set(r.id, {kind: e.target.value as RuleRow['kind']})
                      }
                    />
                  </Td>
                  <Td>
                    {r.kind === 'range' && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          inputSize="sm"
                          type="number"
                          className="w-24"
                          value={r.min}
                          aria-label={t('quality.min', {n})}
                          placeholder={t('quality.minPh')}
                          onChange={e => set(r.id, {min: e.target.value})}
                        />
                        <span className="text-dim">–</span>
                        <Input
                          inputSize="sm"
                          type="number"
                          className="w-24"
                          value={r.max}
                          aria-label={t('quality.max', {n})}
                          placeholder={t('quality.maxPh')}
                          onChange={e => set(r.id, {max: e.target.value})}
                        />
                      </div>
                    )}
                    {r.kind === 'format' && (
                      <Input
                        inputSize="sm"
                        className="font-mono"
                        value={r.pattern}
                        aria-label={t('quality.pattern', {n})}
                        placeholder="^[A-Z]{2}$"
                        onChange={e => set(r.id, {pattern: e.target.value})}
                      />
                    )}
                    {r.kind === 'freshness' && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          inputSize="sm"
                          type="number"
                          min={1}
                          className="w-24"
                          value={r.hours}
                          aria-label={t('quality.hours', {n})}
                          onChange={e => set(r.id, {hours: e.target.value})}
                        />
                        <span className="text-xs whitespace-nowrap text-muted">
                          {t('quality.hoursUnit')}
                        </span>
                      </div>
                    )}
                    {r.kind === 'ref' && (
                      <NativeSelect
                        size="sm"
                        value={r.refType}
                        placeholder={t('quality.anyType')}
                        aria-label={t('quality.refType', {n})}
                        options={model.types.map(tp => ({
                          value: tp.apiName,
                          label: tp.displayName,
                        }))}
                        onChange={e => set(r.id, {refType: e.target.value})}
                      />
                    )}
                    {r.kind === 'required' && (
                      <span className="text-xs text-dim">
                        {t('quality.noArg')}
                      </span>
                    )}
                    {showIssues && issue && (
                      <p
                        role="alert"
                        className="mt-1 flex items-center gap-1 text-[11px] text-crit"
                      >
                        <AlertTriangle className="size-3" aria-hidden />
                        {t(issue)}
                      </p>
                    )}
                    {!showIssues &&
                      issue &&
                      issue !== 'quality.issues.prop' && (
                        <p className="mt-1 text-[11px] text-warn">{t(issue)}</p>
                      )}
                  </Td>
                  <Td>
                    <NativeSelect
                      size="sm"
                      value={r.onFail}
                      aria-label={t('quality.onFailLabel', {n})}
                      options={ON_FAIL.map(o => ({
                        value: o,
                        label: t(`quality.onFail.${o}`),
                        disabled: o === 'clamp' && r.kind !== 'range',
                      }))}
                      onChange={e =>
                        set(r.id, {onFail: e.target.value as RuleRow['onFail']})
                      }
                    />
                  </Td>
                  <Td>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('quality.remove', {n})}
                      onClick={() => onRules(rules.filter(x => x.id !== r.id))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
      <p className="mt-3 text-[11px] text-dim">{t('quality.footnote')}</p>
    </Panel>
  );
}
