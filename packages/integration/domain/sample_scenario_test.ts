/**
 * @fileoverview Tests for the built-in sample scenario and its CSV files.
 */

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  compileOntology,
  SUPPLY_CHAIN_DEFINITION,
} from '@ontodecide/ontology/domain';
import {describe, expect, it} from 'vitest';
import {SAMPLE_SCENARIO} from '../contract';
import {mapRows, mappingIssues} from './mapping';
import {SAMPLE_ROWS, sampleDatasets, toCsv} from './sample_scenario';
import {supplyChainSchema} from './schema_fixture';

const SAMPLES_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'samples',
  'supply-chain',
);

describe('sample scenario', () => {
  const schema = supplyChainSchema();
  const datasets = sampleDatasets();

  it('has exactly 80 objects and 160 links that pass the row checks', () => {
    let objects = 0;
    let links = 0;
    const keys = new Set<string>();
    for (const ds of datasets) {
      expect(mappingIssues(ds.mapping, schema)).toEqual([]);
      const out = mapRows({
        rows: ds.rows,
        firstRow: 1,
        mapping: ds.mapping,
        type: schema.objectTypes[ds.mapping.targetType],
        seen: new Set(),
      });
      expect(out.rejects).toEqual([]);
      objects += out.cmds.length;
      for (const c of out.cmds) {
        keys.add(`${c.type}:${c.primaryKey}`);
        for (const l of c.links ?? []) {
          expect(keys.has(`${l.toType}:${l.toKey}`)).toBe(true);
          links++;
        }
      }
    }
    expect(objects).toBe(SAMPLE_SCENARIO.objects);
    expect(objects).toBe(SAMPLE_ROWS);
    expect(links).toBe(SAMPLE_SCENARIO.links);
    expect(keys.size).toBe(80);
  });

  it('uses only properties of the real ontology template', () => {
    const real = compileOntology(SUPPLY_CHAIN_DEFINITION, {
      templateId: 'supply-chain',
      templateVersion: '1.0.0',
      custom: false,
      etag: 0,
    });
    for (const ds of datasets) {
      expect(mappingIssues(ds.mapping, real)).toEqual([]);
      const type = real.objectTypes[ds.mapping.targetType];
      const out = mapRows({
        rows: ds.rows,
        firstRow: 1,
        mapping: ds.mapping,
        type,
        seen: new Set(),
      });
      expect(out.rejects).toEqual([]);
      for (const l of ds.mapping.links ?? []) {
        expect(real.linkTypes[l.type]).toMatchObject({
          from: ds.mapping.targetType,
          to: l.toType,
        });
      }
    }
  });

  it('supplier shares of every material sum to 1', () => {
    const shares = new Map<string, number>();
    const suppliers = datasets.find(d => d.mapping.targetType === 'Supplier')!;
    for (const r of suppliers.rows) {
      for (const m of String(r.materials).split(';')) {
        shares.set(m, (shares.get(m) ?? 0) + Number(r.share));
      }
    }
    expect(shares.size).toBe(40);
    for (const v of shares.values()) expect(v).toBeCloseTo(1, 9);
  });

  it('includes risky suppliers and understocked materials for the demo', () => {
    const rows = datasets.flatMap(d => d.rows);
    expect(rows.filter(r => Number(r.riskScore) >= 70).length).toBeGreaterThan(
      2,
    );
    expect(
      rows.filter(
        r => r.stock !== undefined && Number(r.stock) < Number(r.safetyStock),
      ).length,
    ).toBeGreaterThan(2);
  });

  it('matches samples/supply-chain/*.csv', () => {
    for (const ds of datasets) {
      const csv = readFileSync(join(SAMPLES_DIR, ds.file), 'utf8');
      expect(csv).toBe(toCsv(ds.rows));
    }
  });
});
