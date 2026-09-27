/**
 * @fileoverview Tests of upsert planning: key matching, merging, duplicate
 * rows, limits and link resolution.
 */

import {describe, expect, it} from 'vitest';
import type {Rid} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import {linkKey, planChanges, planUpsert} from './entity_resolution';
import type {PlanInput} from './entity_resolution';
import type {StoredObject} from './stored_object';

const schema = {
  objectTypes: {
    Supplier: {
      apiName: 'Supplier',
      displayName: 'Supplier',
      primaryKey: 'id',
      titleProperty: 'name',
      properties: [
        {apiName: 'id', displayName: 'id', dataType: 'string', required: true},
        {
          apiName: 'name',
          displayName: 'name',
          dataType: 'string',
          required: true,
        },
        {apiName: 'score', displayName: 'score', dataType: 'double'},
      ],
      propsByName: {},
      indexedProps: ['score'],
      sensitiveProps: [],
    },
    Part: {
      apiName: 'Part',
      displayName: 'Part',
      primaryKey: 'id',
      titleProperty: 'id',
      properties: [{apiName: 'id', displayName: 'id', dataType: 'string'}],
      propsByName: {},
      indexedProps: [],
      sensitiveProps: [],
    },
  },
  linkTypes: {
    supplies: {
      apiName: 'supplies',
      displayName: 's',
      from: 'Supplier',
      to: 'Part',
      cardinality: 'many',
    },
  },
} as unknown as CompiledSchema;
for (const t of Object.values(schema.objectTypes)) {
  t.propsByName = Object.fromEntries(t.properties.map(p => [p.apiName, p]));
}

let n = 0;
function input(over: Partial<PlanInput>): PlanInput {
  return {
    schema,
    cmds: [],
    existing: [],
    existingLinks: new Map(),
    counts: {objects: 0, links: 0},
    caps: {maxObjects: 300, maxLinks: 900},
    jobId: 'job',
    nowMs: 1000,
    newRid: type => `ri.${type}.${String(++n).padStart(26, '0')}` as Rid,
    ...over,
  };
}

const existingS1: StoredObject = {
  rid: 'ri.Supplier.00000000000000000000000EX1' as Rid,
  type: 'Supplier',
  primaryKey: 'S1',
  title: 'One',
  props: {id: 'S1', name: 'One', score: 1},
  provenance: {},
  propsHash: 'h',
  version: 3,
  updatedAt: 0,
};

describe('planUpsert', () => {
  it('creates new objects with provenance and the primary key prop', () => {
    const plan = planUpsert(
      input({
        cmds: [
          {type: 'Supplier', primaryKey: ' S1 ', props: {name: 'A'}, row: 4},
        ],
      }),
    );
    expect(plan.upserted).toBe(1);
    const o = plan.objects[0];
    expect(o).toMatchObject({
      primaryKey: 'S1',
      title: 'A',
      isNew: true,
      newOrdinal: 1,
    });
    expect(o.state.props).toEqual({id: 'S1', name: 'A'});
    expect(o.state.provenance.name).toEqual({jobId: 'job', row: 4, at: 1000});
  });

  it('matches existing objects by (type, primary key) and skips no-ops', () => {
    const plan = planUpsert(
      input({
        existing: [existingS1],
        cmds: [
          {
            type: 'Supplier',
            primaryKey: 'S1',
            props: {name: 'One', score: 1},
            row: 1,
          },
          {type: 'Supplier', primaryKey: 'S1', props: {score: 2}, row: 2},
          {type: 'Supplier', primaryKey: 'S1', props: {score: 2}, row: 3},
        ],
      }),
    );
    expect(plan).toMatchObject({upserted: 1, skipped: 2, rejected: []});
    expect(plan.objects).toHaveLength(1);
    expect(plan.objects[0]).toMatchObject({
      rid: existingS1.rid,
      isNew: false,
      rows: [2],
    });
    expect(plan.objects[0].changed).toEqual(['score']);
  });

  it('merges duplicate new rows into one object', () => {
    const plan = planUpsert(
      input({
        cmds: [
          {type: 'Supplier', primaryKey: 'S2', props: {name: 'A'}, row: 1},
          {
            type: 'Supplier',
            primaryKey: 'S2',
            props: {name: 'B', score: 3},
            row: 2,
          },
        ],
      }),
    );
    expect(plan.objects).toHaveLength(1);
    expect(plan.objects[0].state.props).toEqual({
      id: 'S2',
      name: 'B',
      score: 3,
    });
    expect(plan.objects[0].rows).toEqual([1, 2]);
    expect(plan.upserted).toBe(2);
  });

  it('enforces the object limit on new objects only', () => {
    const plan = planUpsert(
      input({
        existing: [existingS1],
        counts: {objects: 299, links: 0},
        cmds: [
          {type: 'Supplier', primaryKey: 'S1', props: {score: 5}, row: 1},
          {type: 'Supplier', primaryKey: 'N1', props: {name: 'n'}, row: 2},
          {type: 'Supplier', primaryKey: 'N2', props: {name: 'n'}, row: 3},
        ],
      }),
    );
    expect(plan.upserted).toBe(2);
    expect(plan.rejected).toEqual([{row: 3, code: 'OBJECT_LIMIT'}]);
  });

  it('resolves links against the batch and existing objects', () => {
    const p1: StoredObject = {
      ...existingS1,
      rid: 'ri.Part.00000000000000000000000EX2' as Rid,
      type: 'Part',
      primaryKey: 'P1',
      props: {id: 'P1'},
    };
    const plan = planUpsert(
      input({
        existing: [existingS1, p1],
        existingLinks: new Map([
          [linkKey(existingS1.rid, 'supplies', p1.rid), null],
        ]),
        counts: {objects: 2, links: 899},
        cmds: [
          {
            type: 'Supplier',
            primaryKey: 'S1',
            props: {},
            row: 1,
            links: [
              {type: 'supplies', toType: 'Part', toKey: 'P1'},
              {type: 'supplies', toType: 'Part', toKey: 'P2'},
              {type: 'supplies', toType: 'Part', toKey: 'P3'},
              {type: 'supplies', toType: 'Part', toKey: 'P9'},
              {type: 'nope', toType: 'Part', toKey: 'P1'},
            ],
          },
          {type: 'Part', primaryKey: 'P2', props: {}, row: 2},
          {type: 'Part', primaryKey: 'P3', props: {}, row: 3},
        ],
      }),
    );
    expect(
      plan.links.map(l => [l.dst.split('.')[1], l.isNew, l.newOrdinal]),
    ).toEqual([['Part', true, 1]]);
    expect(plan.rejected).toEqual([
      {row: 1, code: 'LINK_LIMIT', detail: 'supplies'},
      {row: 1, code: 'REF_MISSING', detail: 'supplies->Part'},
      {row: 1, code: 'VALIDATION', detail: 'link:nope'},
    ]);
    // Existing S1 unchanged but its new link is reported as a change.
    const changes = planChanges(plan);
    expect(changes.find(c => c.rid === existingS1.rid)).toEqual({
      rid: existingS1.rid,
      type: 'Supplier',
      changed: [],
    });
  });

  it('rejects unknown types, empty keys and invalid values', () => {
    const plan = planUpsert(
      input({
        cmds: [
          {type: 'X', primaryKey: 'a', props: {}, row: 1},
          {type: 'Supplier', primaryKey: '  ', props: {name: 'a'}, row: 2},
          {
            type: 'Supplier',
            primaryKey: 'a',
            props: {name: 'a', score: 'high'},
            row: 3,
          },
          {type: 'Supplier', primaryKey: 'b', props: {}, row: 4},
        ],
      }),
    );
    expect(plan.rejected.map(r => [r.row, r.code, r.detail])).toEqual([
      [1, 'UNKNOWN_TYPE', undefined],
      [2, 'VALIDATION', 'id:REQUIRED'],
      [3, 'VALIDATION', 'score:TYPE'],
      [4, 'VALIDATION', 'name:REQUIRED'],
    ]);
  });
});
