/**
 * @fileoverview Automation form model: form ↔ def, limits and summaries.
 */

import type {AutomationDto} from '@ontodecide/situation/contract';
import type {TFunction} from 'i18next';
import {describe, expect, it} from 'vitest';
import {newCondition, newGroup} from '../../entities/schema/filter_model';
import {toUiModel} from '../../entities/schema/model';
import {makeAutomations, ontologyDto} from '../../test/fixtures/business';
import {
  conditionSummary,
  cooldownText,
  emptyForm,
  formFromDto,
  propMap,
  saveBlockReason,
  scheduledCount,
  toDef,
  triggerSummary,
  validateForm,
} from './automation_model';

const model = toUiModel(ontologyDto, 'zh-CN');
const supplier = model.byName.Supplier;
const props = propMap(supplier);
const t = ((k: string, o?: Record<string, unknown>) =>
  o ? `${k}${JSON.stringify(o)}` : k) as unknown as TFunction;

describe('form ↔ def', () => {
  it('round-trips stored automations', () => {
    for (const a of makeAutomations()) {
      const type = model.byName[a.objectType];
      const def = toDef(formFromDto(a), propMap(type));
      const {id: _i, version: _v, nextRunAt: _n, lastFiredAt: _l, ...rest} = a;
      expect(def).toEqual(rest);
    }
  });

  it('builds nested AND / OR conditions and omits an empty English name', () => {
    const f = emptyForm('Supplier');
    f.nameZh = ' 高风险 ';
    f.condition = newGroup('and', [
      newCondition('riskScore', 'gte', '70'),
      newGroup('or', [
        newCondition('status', 'eq', 'watch'),
        newCondition('capacityPerWeek', 'lt', '5000'),
      ]),
    ]);
    const r = validateForm(f, props);
    expect(r.errors).toEqual({});
    expect(r.def).toEqual({
      name: {'zh-CN': '高风险'},
      trigger: 'threshold',
      objectType: 'Supplier',
      condition: {
        op: 'and',
        args: [
          {op: 'gte', prop: 'riskScore', value: 70},
          {
            op: 'or',
            args: [
              {op: 'eq', prop: 'status', value: 'watch'},
              {op: 'lt', prop: 'capacityPerWeek', value: 5000},
            ],
          },
        ],
      },
      severity: 'MEDIUM',
      cooldownSec: 3600,
      enabled: true,
    });
  });

  it('validates required fields and the cooldown range', () => {
    const f = emptyForm('');
    f.cooldownSec = '90000';
    expect(validateForm(f, {}).errors).toEqual({
      nameZh: 'nameRequired',
      objectType: 'typeRequired',
      cooldownSec: 'cooldownRange',
      condition: 'conditionRequired',
    });
  });

  it('includes everyHours only for schedules', () => {
    const f = formFromDto(makeAutomations()[1]);
    f.everyHours = '6';
    expect(toDef(f, propMap(model.byName.Material)).everyHours).toBe(6);
    f.trigger = 'threshold';
    expect(toDef(f, {})).not.toHaveProperty('everyHours');
  });
});

describe('save block reasons', () => {
  const list = makeAutomations();
  const sched = (h: string) => ({
    ...emptyForm('Material'),
    trigger: 'schedule' as const,
    everyHours: h,
  });
  const three: AutomationDto[] = [
    ...list,
    {...list[1], id: 'a3'},
    {...list[1], id: 'a4'},
  ];

  it('limits scheduled rules to 3 per workspace', () => {
    expect(scheduledCount(list)).toBe(1);
    expect(saveBlockReason(sched('1'), list)).toBeNull();
    expect(saveBlockReason(sched('1'), three)).toBe('scheduleLimit');
    // Editing one of the three is allowed.
    expect(saveBlockReason(sched('2'), three, 'a3')).toBeNull();
    // Threshold rules are not limited.
    expect(saveBlockReason(emptyForm('Supplier'), three)).toBeNull();
  });

  it('requires 1..24 whole hours', () => {
    expect(saveBlockReason(sched('0'), list)).toBe('minInterval');
    expect(saveBlockReason(sched(''), list)).toBe('minInterval');
    expect(saveBlockReason(sched('0.5'), list)).toBe('minInterval');
    expect(saveBlockReason(sched('1.5'), list)).toBe('intervalInteger');
    expect(saveBlockReason(sched('25'), list)).toBe('maxInterval');
    expect(saveBlockReason(sched('24'), list)).toBeNull();
  });
});

describe('summaries', () => {
  it('renders conditions with property names and nesting', () => {
    expect(
      conditionSummary(
        {
          op: 'or',
          args: [
            {op: 'lt', prop: 'capacityPerWeek', value: 5000},
            {
              op: 'and',
              args: [
                {op: 'eq', prop: 'status', value: 'watch'},
                {op: 'exists', prop: 'riskScore'},
              ],
            },
          ],
        },
        supplier,
        t,
      ),
    ).toBe(
      '周产能 ops.lt 5000 summary.or (状态 ops.eq watch summary.and 风险分 ops.exists)',
    );
  });

  it('renders triggers and cooldowns', () => {
    expect(triggerSummary({trigger: 'schedule', everyHours: 2}, t)).toBe(
      'summary.every{"count":2}',
    );
    expect(triggerSummary({trigger: 'threshold'}, t)).toBe('summary.threshold');
    expect(cooldownText(0, t)).toBe('summary.cooldownNone');
    expect(cooldownText(7200, t)).toBe('summary.cooldownHours{"count":2}');
    expect(cooldownText(120, t)).toBe('summary.cooldownMinutes{"count":2}');
    expect(cooldownText(45, t)).toBe('summary.cooldownSeconds{"count":45}');
  });
});
