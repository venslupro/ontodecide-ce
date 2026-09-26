import {describe, expect, it} from 'vitest';
import type {ActionTypeDef} from '@ontodecide/ontology/contract';
import type {Rid} from '@ontodecide/shared-kernel';
import {
  applyEffects,
  evaluatePreconditions,
  normalizeParams,
  objectRefParams,
  planLinkChanges,
} from './action_execution';

const increaseSafetyStock: ActionTypeDef = {
  apiName: 'increaseSafetyStock',
  displayName: 'Increase safety stock',
  targetType: 'Product',
  parameters: [
    {
      apiName: 'days',
      displayName: 'Days',
      dataType: 'integer',
      required: true,
      defaultValue: 7,
    },
  ],
  preconditions: [
    {
      expr: {
        and: [
          {'>': [{var: 'params.days'}, 0]},
          {'<=': [{var: 'params.days'}, 30]},
        ],
      },
      message: {
        'zh-CN': '增加天数须在 1–30 之间',
        'en-US': 'Extra days must be between 1 and 30',
      },
    },
  ],
  effects: [
    {kind: 'increment', prop: 'inventoryDays', by: {var: 'params.days'}},
    {kind: 'increment', prop: 'safetyStockDays', by: {var: 'params.days'}},
  ],
  requiresApproval: true,
};

const switchSupplier: ActionTypeDef = {
  apiName: 'switchSupplier',
  displayName: 'Switch supplier',
  targetType: 'Material',
  parameters: [
    {
      apiName: 'newSupplier',
      displayName: 'New',
      dataType: 'objectRef:Supplier',
      required: true,
    },
  ],
  preconditions: [],
  effects: [
    {kind: 'relink', link: 'supplies', direction: 'in', toParam: 'newSupplier'},
  ],
  requiresApproval: true,
};

const flagSupplier: ActionTypeDef = {
  apiName: 'flagSupplier',
  displayName: 'Flag supplier',
  targetType: 'Supplier',
  parameters: [{apiName: 'reason', displayName: 'Reason', dataType: 'string'}],
  preconditions: [
    {
      expr: {'!==': [{var: 'target.status'}, 'suspended']},
      message: {'en-US': 'Suspended suppliers cannot be flagged'},
    },
  ],
  effects: [{kind: 'set', prop: 'status', value: 'watch'}],
  requiresApproval: false,
};

const r = (s: string) => s as Rid;

describe('action execution', () => {
  it('increaseSafetyStock: defaults, preconditions and increments', () => {
    const n = normalizeParams(increaseSafetyStock, {});
    expect(n).toEqual({params: {days: 7}, errors: []});
    expect(normalizeParams(increaseSafetyStock, {days: '12'}).params.days).toBe(
      12,
    );
    expect(
      normalizeParams(increaseSafetyStock, {days: 'x'}).errors[0].param,
    ).toBe('days');

    const target = {inventoryDays: 10, safetyStockDays: 5};
    expect(
      evaluatePreconditions(increaseSafetyStock, target, {days: 7}),
    ).toEqual([]);
    expect(
      evaluatePreconditions(increaseSafetyStock, target, {days: 40}),
    ).toEqual(['Extra days must be between 1 and 30']);
    expect(
      evaluatePreconditions(increaseSafetyStock, target, {days: 40}, 'zh-CN'),
    ).toEqual(['增加天数须在 1–30 之间']);
    const out = applyEffects(increaseSafetyStock, target, {days: 7});
    expect(out.updates).toEqual({inventoryDays: 17, safetyStockDays: 12});
    expect(
      applyEffects(increaseSafetyStock, {}, {days: 3}).updates.inventoryDays,
    ).toBe(3);
  });

  it('flagSupplier: set effect and precondition on target', () => {
    expect(
      evaluatePreconditions(flagSupplier, {status: 'suspended'}, {}),
    ).toHaveLength(1);
    expect(evaluatePreconditions(flagSupplier, {status: 'active'}, {})).toEqual(
      [],
    );
    expect(applyEffects(flagSupplier, {status: 'active'}, {}).updates).toEqual({
      status: 'watch',
    });
  });

  it('switchSupplier: relink replaces incoming supplies links', () => {
    expect(objectRefParams(switchSupplier)).toEqual([
      {param: 'newSupplier', objectType: 'Supplier'},
    ]);
    expect(normalizeParams(switchSupplier, {}).errors[0].detail).toMatch(
      /required/,
    );
    const eff = applyEffects(
      switchSupplier,
      {},
      {newSupplier: 'ri.t.Supplier.S2'},
    );
    expect(eff.linkEffects).toEqual([
      {
        kind: 'relink',
        link: 'supplies',
        direction: 'in',
        to: 'ri.t.Supplier.S2',
      },
    ]);
    const existing = [
      {
        type: 'supplies',
        src: r('ri.t.Supplier.S1'),
        dst: r('ri.t.Material.M1'),
        weight: 0.6,
      },
      {type: 'usedIn', src: r('ri.t.Material.M1'), dst: r('ri.t.Product.P1')},
    ];
    const plan = planLinkChanges(
      r('ri.t.Material.M1'),
      eff.linkEffects,
      existing,
    );
    expect(plan.remove).toEqual([existing[0]]);
    expect(plan.add).toEqual([
      {
        type: 'supplies',
        src: 'ri.t.Supplier.S2',
        dst: 'ri.t.Material.M1',
        weight: 0.6,
      },
    ]);
    // Relinking to the current supplier changes nothing.
    const same = planLinkChanges(
      r('ri.t.Material.M1'),
      [
        {
          kind: 'relink',
          link: 'supplies',
          direction: 'in',
          to: r('ri.t.Supplier.S1'),
        },
      ],
      existing,
    );
    expect(same).toEqual({remove: [], add: []});
  });

  it('unlink removes all or one link on the side', () => {
    const existing = [
      {type: 'supplies', src: r('A'), dst: r('M')},
      {type: 'supplies', src: r('B'), dst: r('M')},
    ];
    expect(
      planLinkChanges(
        r('M'),
        [{kind: 'unlink', link: 'supplies', direction: 'in'}],
        existing,
      ).remove,
    ).toHaveLength(2);
    expect(
      planLinkChanges(
        r('M'),
        [{kind: 'unlink', link: 'supplies', direction: 'in', to: r('B')}],
        existing,
      ).remove,
    ).toEqual([existing[1]]);
  });
});
