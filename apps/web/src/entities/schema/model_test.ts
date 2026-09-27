/**
 * @fileoverview OntologyDto → UiModel mapping: localized names, links and
 * actions per type, ordering helpers and RID helpers.
 */

import {describe, expect, it} from 'vitest';
import {ontologyDto} from '../../test/fixtures/business';
import {
  numericProperties,
  orderedProperties,
  riskProperties,
  shortRid,
  toUiModel,
  typeOfRid,
} from './model';

describe('toUiModel', () => {
  it('resolves display names for the language', () => {
    const zh = toUiModel(ontologyDto, 'zh-CN');
    const en = toUiModel(ontologyDto, 'en-US');
    expect(zh.byName.Supplier.displayName).toBe('供应商');
    expect(en.byName.Supplier.displayName).toBe('Supplier');
    expect(
      en.byName.Supplier.properties.find(p => p.apiName === 'riskScore')!
        .displayName,
    ).toBe('Risk score');
    expect(zh.simulationKpis[0].displayName).toBe('准时交付率');
  });

  it('attaches links and actions to their object types', () => {
    const m = toUiModel(ontologyDto, 'zh-CN');
    expect(m.byName.Material.links.map(l => l.apiName).sort()).toEqual([
      'orders',
      'supplies',
      'usedAt',
    ]);
    expect(m.byName.Supplier.actions.map(a => a.apiName)).toEqual([
      'suspendSupplier',
      'reactivateSupplier',
    ]);
    expect(m.linksByName.supplies.propagates).toBe(true);
    expect(m.actionsByName.switchSupplier.preconditions[0].message).toBe(
      '订单已无法挽回',
    );
    expect(m.etag).toBe(0);
    expect(m.custom).toBe(false);
  });

  it('orders the title and primary key first and finds risk props', () => {
    const t = toUiModel(ontologyDto, 'zh-CN').byName.Supplier;
    expect(
      orderedProperties(t)
        .map(p => p.apiName)
        .slice(0, 2),
    ).toEqual(['name', 'supplierId']);
    expect(orderedProperties(t)).toHaveLength(t.properties.length);
    expect(riskProperties(t).map(p => p.apiName)).toEqual(['riskScore']);
    expect(numericProperties(t).map(p => p.apiName)).toEqual([
      'riskScore',
      'onTimeRate',
      'capacityPerWeek',
    ]);
  });

  it('parses RIDs', () => {
    const r = 'ri.Supplier.01J90000000000000000000017';
    expect(typeOfRid(r)).toBe('Supplier');
    expect(shortRid(r)).toBe('Supplier·000017');
    expect(typeOfRid('nope')).toBeUndefined();
  });
});
