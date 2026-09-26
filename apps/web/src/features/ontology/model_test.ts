/**
 * @fileoverview Workbench model: reducer edits, renames, cleanup and pack
 * file validation.
 */

import {describe, expect, it} from 'vitest';
import {supplyChainSchema} from '../../test/fixtures';
import {
  cleanSchema,
  initialWorkbench,
  parsePackFile,
  workbenchReducer,
} from './model';

describe('workbench model', () => {
  const loaded = workbenchReducer(initialWorkbench('supplyChain'), {
    type: 'load',
    def: supplyChainSchema,
    isNew: false,
  });

  it('loads clean with the first object type selected', () => {
    expect(loaded.dirty).toBe(false);
    expect(loaded.selection).toEqual({kind: 'object', index: 0});
  });

  it('propagates object type renames to links, actions and KPIs', () => {
    const product = loaded.def.objectTypes[2];
    const next = workbenchReducer(loaded, {
      type: 'updateObject',
      index: 2,
      value: {...product, apiName: 'Item'},
    });
    expect(next.dirty).toBe(true);
    expect(next.def.linkTypes.find(l => l.apiName === 'usedIn')?.to).toBe(
      'Item',
    );
    expect(
      next.def.actionTypes.find(a => a.apiName === 'increaseSafetyStock')
        ?.targetType,
    ).toBe('Item');
    expect(next.def.simulationKpis?.every(k => k.objectType === 'Item')).toBe(
      true,
    );
  });

  it('adjusts the selection when removing items', () => {
    const sel = workbenchReducer(loaded, {
      type: 'select',
      selection: {kind: 'object', index: 2},
    });
    const next = workbenchReducer(sel, {
      type: 'remove',
      kind: 'object',
      index: 0,
    });
    expect(next.def.objectTypes).toHaveLength(2);
    expect(next.selection).toEqual({kind: 'object', index: 1});
  });

  it('strips empty optional values on save', () => {
    const def = structuredClone(loaded.def);
    def.objectTypes[0].properties[0] = {
      ...def.objectTypes[0].properties[0],
      unit: '',
      markings: [],
      indexed: false,
    };
    const out = cleanSchema(def);
    const p = out.objectTypes[0].properties[0];
    expect(p).not.toHaveProperty('unit');
    expect(p).not.toHaveProperty('markings');
    expect(p).not.toHaveProperty('indexed');
  });

  it('validates pack files', () => {
    expect(parsePackFile('{').ok).toBe(false);
    const bad = parsePackFile(
      JSON.stringify({
        id: 'x',
        name: 'X',
        version: '1.0.0',
        schema: {apiName: '1bad'},
      }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.issues.some(i => i.startsWith('schema.apiName'))).toBe(true);
    const good = parsePackFile(
      JSON.stringify({
        id: 'sc',
        name: 'SC',
        version: '1.0.0',
        schema: supplyChainSchema,
      }),
    );
    expect(good.ok).toBe(true);
  });
});
