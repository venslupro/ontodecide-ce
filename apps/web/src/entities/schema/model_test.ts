/**
 * @fileoverview CompiledModel → UiObjectType mapping: localized names,
 * markings-based visibility, links/actions per type.
 */

import {describe, expect, it} from 'vitest';
import {compiledModel} from '../../test/fixtures';
import {canSee, orderedProperties, riskProperties, toUiModel} from './model';

describe('toUiModel', () => {
  it('resolves display names for the language', () => {
    const zh = toUiModel(compiledModel, 'zh-CN', []);
    const en = toUiModel(compiledModel, 'en-US', []);
    expect(zh.byName.Supplier.displayName).toBe('供应商');
    expect(en.byName.Supplier.displayName).toBe('Supplier');
    expect(
      en.byName.Supplier.properties.find(p => p.apiName === 'riskScore')!
        .displayName,
    ).toBe('Risk score');
    expect(zh.simulationKpis[0].displayName).toBe('可满足日需求');
  });

  it('computes visibility from markings', () => {
    const none = toUiModel(compiledModel, 'zh-CN', []);
    const pii = toUiModel(compiledModel, 'zh-CN', ['PII']);
    const all = toUiModel(compiledModel, 'zh-CN', ['*']);
    const email = (m: typeof none) =>
      m.byName.Supplier.properties.find(p => p.apiName === 'contactEmail')!
        .visible;
    expect(email(none)).toBe(false);
    expect(email(pii)).toBe(true);
    expect(email(all)).toBe(true);
    expect(canSee(['A', 'B'], ['A'])).toBe(false);
    expect(canSee(undefined, [])).toBe(true);
  });

  it('attaches links and actions to their types', () => {
    const m = toUiModel(compiledModel, 'zh-CN', []);
    expect(m.byName.Material.links.map(l => l.apiName).sort()).toEqual([
      'supplies',
      'usedIn',
    ]);
    expect(m.byName.Material.actions.map(a => a.apiName)).toEqual([
      'switchSupplier',
    ]);
    const inc = m.byName.Product.actions[0];
    expect(inc.parameters[0]).toMatchObject({
      apiName: 'days',
      dataType: 'integer',
      required: true,
      defaultValue: 7,
    });
    expect(inc.preconditions).toEqual(['增加天数须在 1–30 之间']);
  });

  it('orders title and key first and finds risk properties', () => {
    const t = toUiModel(compiledModel, 'zh-CN', []).byName.Supplier;
    expect(
      orderedProperties(t)
        .slice(0, 2)
        .map(p => p.apiName),
    ).toEqual(['name', 'supplierId']);
    expect(riskProperties(t).map(p => p.apiName)).toEqual(['riskScore']);
  });
});
