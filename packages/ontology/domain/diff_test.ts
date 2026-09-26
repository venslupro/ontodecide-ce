/**
 * @fileoverview Tests for schema diffs, breaking changes and semver.
 */

import {describe, expect, it} from 'vitest';
import type {SchemaDef} from '../contract';
import {diffSchemas} from './diff';
import {SUPPLY_CHAIN_PACK} from './packs/supply_chain';
import {bumpSemver, compareSemver, maxSemver} from './semver';

const base = (): SchemaDef => structuredClone(SUPPLY_CHAIN_PACK.schema);
const current = () => ({version: '1.0.0', definition: base()});

describe('diffSchemas', () => {
  it('first publish uses the draft version or 1.0.0', () => {
    const d = diffSchemas(null, base());
    expect(d).toMatchObject({
      fromVersion: null,
      toVersion: '1.0.0',
      breaking: false,
    });
    expect(d.changes.filter(c => c.kind === 'objectTypeAdded')).toHaveLength(3);
    const own = {...base(), version: '0.3.0'};
    expect(diffSchemas(null, own).toVersion).toBe('0.3.0');
    const none = base();
    delete none.version;
    expect(diffSchemas(null, none).suggestedVersion).toBe('1.0.0');
  });

  it('no changes suggests a patch', () => {
    const d = diffSchemas(current(), base());
    expect(d.changes).toEqual([]);
    expect(d).toMatchObject({
      breaking: false,
      suggestedVersion: '1.0.1',
      toVersion: '1.0.1',
    });
  });

  it('additions suggest a minor bump', () => {
    const def = base();
    def.objectTypes[0].properties.push({
      apiName: 'region',
      displayName: 'Region',
      dataType: 'string',
    });
    const d = diffSchemas(current(), def);
    expect(d.changes).toEqual([
      {
        kind: 'propertyAdded',
        path: 'objectTypes.Supplier.properties.region',
        breaking: false,
      },
    ]);
    expect(d.suggestedVersion).toBe('1.1.0');
  });

  it('non-breaking property and action changes suggest a patch', () => {
    const def = base();
    def.objectTypes[0].properties[1].displayName = 'Supplier name';
    def.actionTypes[0].requiresApproval = false;
    const d = diffSchemas(current(), def);
    expect(d.changes.map(c => c.kind)).toEqual([
      'propertyChanged',
      'actionTypeChanged',
    ]);
    expect(d).toMatchObject({breaking: false, suggestedVersion: '1.0.1'});
  });

  it.each([
    [
      'removing an object type',
      (d: SchemaDef) => d.objectTypes.splice(2, 1),
      'objectTypeRemoved',
    ],
    [
      'removing a property',
      (d: SchemaDef) => d.objectTypes[0].properties.pop(),
      'propertyRemoved',
    ],
    ['removing a link', (d: SchemaDef) => d.linkTypes.pop(), 'linkTypeRemoved'],
    [
      'removing an action',
      (d: SchemaDef) => d.actionTypes.pop(),
      'actionTypeRemoved',
    ],
    [
      'changing a data type',
      (d: SchemaDef) => (d.objectTypes[0].properties[3].dataType = 'string'),
      'propertyTypeChanged',
    ],
  ])('%s is breaking and suggests a major bump', (_n, mutate, kind) => {
    const def = base();
    mutate(def);
    const d = diffSchemas(current(), def);
    expect(d.breaking).toBe(true);
    expect(d.changes.find(c => c.kind === kind)?.breaking).toBe(true);
    expect(d.suggestedVersion).toBe('2.0.0');
  });

  it('uses the draft version when newer than current', () => {
    const def = {...base(), version: '3.0.0'};
    expect(diffSchemas(current(), def).toVersion).toBe('3.0.0');
    const stale = {...base(), version: '1.0.0'};
    expect(diffSchemas(current(), stale).toVersion).toBe('1.0.1');
  });
});

describe('semver', () => {
  it('compares numerically, not lexically', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(maxSemver(['1.9.0', '1.10.0', 'draft', '0.1.0'])).toBe('1.10.0');
    expect(maxSemver([])).toBeNull();
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0');
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpSemver('1.2.3', 'patch')).toBe('1.2.4');
  });
});
