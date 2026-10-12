/**
 * @fileoverview Consistency checks applied identically to every built-in
 * example scenario: the sample rows map cleanly onto the scenario's real
 * ontology template, link targets are written no later than their sources,
 * object / link counts equal the contract metadata shown to users, and
 * `samples/<scenario>/*.csv` contain exactly the generated rows.
 *
 * Regenerate the CSV files after changing sample rows with:
 *   UPDATE_SAMPLES=1 pnpm vitest run packages/integration/domain/scenarios_test.ts
 */

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {compileOntology, findTemplate} from '@ontodecide/ontology/domain';
import {describe, expect, it} from 'vitest';
import {BUILT_IN_SCENARIOS} from '../contract';
import {mapRows, mappingIssues} from './mapping';
import {toCsv} from './sample_scenario';
import {SAMPLE_SCENARIOS} from './scenarios';

const SAMPLES_DIR = join(import.meta.dirname, '..', '..', '..', 'samples');
const UPDATE = process.env.UPDATE_SAMPLES === '1';

describe('built-in scenarios', () => {
  it('cover every scenario in the contract, in order', () => {
    expect(SAMPLE_SCENARIOS.map(s => s.id)).toEqual(
      BUILT_IN_SCENARIOS.map(s => s.id),
    );
  });

  describe.each(SAMPLE_SCENARIOS.map(s => [s.id, s] as const))(
    '%s',
    (id, s) => {
      const template = findTemplate(s.templateId);
      const datasets = s.datasets();

      it('has a built-in ontology template', () => {
        expect(template).not.toBeNull();
      });

      it('maps onto the real template with counts matching the metadata', () => {
        const schema = compileOntology(template!.definition, {
          templateId: template!.id,
          templateVersion: template!.version,
          custom: false,
          etag: 0,
        });
        const written = new Set<string>();
        let objects = 0;
        let links = 0;
        for (const ds of datasets) {
          expect(mappingIssues(ds.mapping, schema), ds.file).toEqual([]);
          for (const l of ds.mapping.links ?? []) {
            expect(
              schema.linkTypes[l.type],
              `${ds.file}:${l.type}`,
            ).toMatchObject({from: ds.mapping.targetType, to: l.toType});
          }
          const out = mapRows({
            rows: ds.rows,
            firstRow: 1,
            mapping: ds.mapping,
            type: schema.objectTypes[ds.mapping.targetType],
            seen: new Set(),
          });
          expect(out.rejects, ds.file).toEqual([]);
          // A batch resolves links against earlier batches and itself.
          for (const c of out.cmds) written.add(`${c.type}:${c.primaryKey}`);
          for (const c of out.cmds) {
            for (const l of c.links ?? []) {
              expect(written, `${ds.file}:${c.primaryKey}`).toContain(
                `${l.toType}:${l.toKey}`,
              );
              links++;
            }
          }
          objects += out.cmds.length;
        }
        expect(written.size).toBe(objects);
        expect({objects, links}).toEqual({objects: s.objects, links: s.links});
      });

      it(`matches samples/${id}/*.csv`, () => {
        const dir = join(SAMPLES_DIR, id);
        if (UPDATE) mkdirSync(dir, {recursive: true});
        for (const ds of datasets) {
          const path = join(dir, ds.file);
          if (UPDATE) writeFileSync(path, toCsv(ds.rows));
          expect(readFileSync(path, 'utf8'), ds.file).toBe(toCsv(ds.rows));
        }
      });
    },
  );
});
