/**
 * @fileoverview Tests for the deterministic mapping draft.
 */

import {describe, expect, it} from 'vitest';
import {
  jaroWinkler,
  mergeAiPairs,
  nameSimilarity,
  normalizeName,
  ruleDraft,
  transformFor,
} from './matching';
import {sampleDatasets} from './sample_scenario';
import {supplyChainSchema} from './schema_fixture';

const schema = supplyChainSchema();

describe('similarity', () => {
  it('normalizes names', () => {
    expect(normalizeName(' Supplier_ID ')).toBe('supplierid');
    expect(normalizeName('风险（分）')).toBe('风险分');
  });

  it('computes Jaro-Winkler', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('', 'abc')).toBe(0);
    expect(nameSimilarity('supplier_risk_score', 'riskScore')).toBe(0.9);
    expect(nameSimilarity('xyz', 'riskScore')).toBeLessThan(0.85);
  });

  it('suggests transforms by data type', () => {
    const t = schema.objectTypes.Supplier.propsByName;
    expect(transformFor(t.riskScore)).toBe('trim|toNumber');
    expect(transformFor(t.status)).toBe('trim|lower');
    expect(transformFor(t.name)).toBe('trim');
  });
});

describe('ruleDraft', () => {
  it('matches exact, synonym (zh / en) and similar names', () => {
    const type = schema.objectTypes.Supplier;
    const d = ruleDraft(
      schema,
      type,
      [
        '供应商编号',
        'Vendor Name',
        'Country',
        'supplier_risk_score',
        '准时率',
        'notes',
      ],
      [],
    );
    const by = Object.fromEntries(
      d.spec.fields.map(f => [f.to, [f.from, f.matchedBy]]),
    );
    expect(by).toEqual({
      supplierId: ['供应商编号', 'synonym'],
      name: ['Vendor Name', 'synonym'],
      country: ['Country', 'exact'],
      riskScore: ['supplier_risk_score', 'similarity'],
      onTimeRate: ['准时率', 'synonym'],
    });
    expect(d.spec.primaryKey.from).toBe('供应商编号');
    expect(d.unmatchedFields).toEqual(['notes']);
    expect(d.unmatchedProps).toEqual(['capacity', 'status', 'contactEmail']);
  });

  it('reproduces the sample mappings from the CSV headers', () => {
    for (const ds of sampleDatasets()) {
      const fields = Object.keys(ds.rows[0]);
      const samples = ds.rows.slice(0, 20).map(r => fields.map(f => r[f]));
      const d = ruleDraft(
        schema,
        schema.objectTypes[ds.mapping.targetType],
        fields,
        samples,
      );
      expect(d.unmatchedFields).toEqual([]);
      expect(d.spec.primaryKey.from).toBe(ds.mapping.primaryKey.from);
      expect(d.spec.links ?? []).toEqual(ds.mapping.links ?? []);
      expect(d.spec.fields.map(f => [f.to, f.from]).sort()).toEqual(
        ds.mapping.fields.map(f => [f.to, f.from]).sort(),
      );
      expect(d.spec.fields.every(f => f.matchedBy === 'exact')).toBe(true);
    }
  });

  it('detects link columns by the target key and weight columns', () => {
    const d = ruleDraft(
      schema,
      schema.objectTypes.Supplier,
      ['supplierId', 'name', '物料编号', '占比'],
      [['S1', 'a', 'M1,M2', '0.5']],
    );
    expect(d.spec.links).toEqual([
      {
        type: 'supplies',
        toType: 'Material',
        toKey: '物料编号',
        split: ',',
        weightFrom: '占比',
      },
    ]);
  });
});

describe('mergeAiPairs', () => {
  it('accepts only unmatched columns and non-sensitive properties once', () => {
    const type = schema.objectTypes.Supplier;
    const d = ruleDraft(
      schema,
      type,
      ['supplierId', 'name', 'volume', 'memo', 'x'],
      [],
    );
    const m = mergeAiPairs(d, type, [
      {from: 'volume', to: 'capacity'},
      {from: 'memo', to: 'contactEmail'},
      {from: 'x', to: 'capacity'},
      {from: 'name', to: 'status'},
      {from: 'ghost', to: 'status'},
    ]);
    const ai = m.spec.fields.filter(f => f.matchedBy === 'ai');
    expect(ai).toEqual([
      {
        to: 'capacity',
        from: 'volume',
        transform: 'trim|toNumber',
        matchedBy: 'ai',
      },
    ]);
    expect(m.unmatchedFields).toEqual(['memo', 'x']);
  });
});
