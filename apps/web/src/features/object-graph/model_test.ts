/**
 * @fileoverview Object-graph view model: URL params, sort cycle, columns,
 * graph slices, action preconditions, merge patch and timeline.
 */

import {describe, expect, it} from 'vitest';
import {toUiModel} from '../../entities/schema/model';
import {
  M2231,
  makeActionLog,
  makeAlerts,
  makeObjects,
  makeRecommendations,
  ontologyDto,
  P01,
  S017,
} from '../../test/fixtures/business';
import {
  actionChanges,
  availableActions,
  buildMergePatch,
  buildTimeline,
  cleanParams,
  filterParam,
  filterSlice,
  missingParams,
  nextSort,
  paramDefaults,
  parseFilterParam,
  parseOrderBy,
  resolveColumns,
  sliceToGraph,
  sliceTypes,
  unmetPreconditions,
} from './model';

const model = toUiModel(ontologyDto, 'zh-CN');
const [s017, s022, , , po] = makeObjects();

describe('URL params', () => {
  it('round-trips filters and rejects invalid JSON', () => {
    const f = {op: 'gt' as const, prop: 'riskScore', value: 50};
    expect(parseFilterParam(filterParam(f))).toEqual(f);
    expect(parseFilterParam(f)).toEqual(f);
    expect(parseFilterParam('{bad')).toBeUndefined();
    expect(parseFilterParam('{"op":"nope"}')).toBeUndefined();
    expect(filterParam(undefined)).toBeUndefined();
  });

  it('parses orderBy and cycles sort', () => {
    expect(parseOrderBy('riskScore:desc')).toEqual({
      prop: 'riskScore',
      dir: 'desc',
    });
    expect(parseOrderBy('x:up')).toBeUndefined();
    expect(nextSort(undefined, 'a')).toEqual({prop: 'a', dir: 'asc'});
    expect(nextSort({prop: 'a', dir: 'asc'}, 'a')).toEqual({
      prop: 'a',
      dir: 'desc',
    });
    expect(nextSort({prop: 'a', dir: 'desc'}, 'a')).toBeUndefined();
    expect(nextSort({prop: 'a', dir: 'desc'}, 'b')).toEqual({
      prop: 'b',
      dir: 'asc',
    });
  });

  it('builds columns from the ontology, title first', () => {
    const cols = resolveColumns(model.byName.Supplier, 3).map(c => c.apiName);
    expect(cols).toEqual(['name', 'supplierId', 'country']);
  });
});

describe('graph slices', () => {
  const slice = {
    nodes: [
      {rid: S017, type: 'Supplier', title: 'S', props: {}, hop: 0},
      {rid: M2231, type: 'Material', title: 'M', props: {}, hop: 1},
      {rid: P01, type: 'Plant', title: 'P', props: {}, hop: 2},
    ],
    edges: [
      {type: 'supplies', src: S017, dst: M2231, weight: 0.9},
      {type: 'usedAt', src: M2231, dst: P01, weight: null},
    ],
    truncated: false,
  };

  it('maps nodes and edges and marks the root', () => {
    const g = sliceToGraph(slice, S017);
    expect(g.nodes.find(n => n.root)?.id).toBe(S017);
    expect(g.edges[0]).toMatchObject({
      source: S017,
      target: M2231,
      type: 'supplies',
    });
    expect(sliceToGraph(undefined)).toEqual({nodes: [], edges: []});
    expect(sliceTypes(slice)).toEqual(['Supplier', 'Material', 'Plant']);
  });

  it('filters by link type keeping reachable nodes', () => {
    const f = filterSlice(slice, ['supplies'])!;
    expect(f.edges).toHaveLength(1);
    expect(f.nodes.map(n => n.rid)).toEqual([S017, M2231]);
    expect(filterSlice(slice, [])).toBe(slice);
  });
});

describe('actions', () => {
  it('evaluates preconditions against the object', () => {
    const suspend = model.actionsByName.suspendSupplier;
    const reactivate = model.actionsByName.reactivateSupplier;
    expect(unmetPreconditions(suspend, s017)).toEqual([]);
    expect(unmetPreconditions(reactivate, s017)).toEqual(['供应商未暂停']);
    expect(
      availableActions(model.byName.Supplier, {
        props: {...s022.props, status: 'suspended'},
      }).map(a => a.apiName),
    ).toEqual(['reactivateSupplier']);
    expect(
      availableActions(model.byName.PurchaseOrder, po).map(a => a.apiName),
    ).toEqual(['switchSupplier']);
    expect(availableActions(undefined, s017)).toEqual([]);
  });

  it('handles parameters', () => {
    const adjust = model.actionsByName.adjustSafetyStock;
    expect(paramDefaults(adjust)).toEqual({delta: 100});
    expect(missingParams(adjust.parameters, {delta: ''})).toEqual(['delta']);
    expect(missingParams(adjust.parameters, {delta: 5})).toEqual([]);
    expect(cleanParams({a: 1, b: '', c: null})).toEqual({a: 1});
  });
});

describe('buildMergePatch', () => {
  it('sets changed values and nulls cleared ones', () => {
    expect(
      buildMergePatch(
        {a: 1, b: 'x', c: 3, d: {x: 1}},
        {a: 1, b: 'y', c: '', d: {x: 1}, e: true},
      ),
    ).toEqual({b: 'y', c: null, e: true});
    expect(buildMergePatch({a: 1}, {a: 1})).toEqual({});
  });
});

describe('timeline', () => {
  it('merges imports, actions, alerts and recommendations newest first', () => {
    const entries = buildTimeline({
      object: s017,
      actions: makeActionLog(),
      alerts: makeAlerts().filter(a => a.rid === S017),
      recommendations: makeRecommendations().filter(r => r.focus === S017),
    });
    expect(entries.map(e => e.kind)).toEqual([
      'import', // capacityPerWeek, 2 min ago
      'alert', // 2 min ago
      'action', // 3 min ago
      'recommendation',
      'import',
      'import',
      'import',
    ]);
    expect(entries.every((e, i) => i === 0 || entries[i - 1].at >= e.at)).toBe(
      true,
    );
    expect(buildTimeline({object: s017, max: 2})).toHaveLength(2);
  });

  it('lists action changes', () => {
    expect(actionChanges(makeActionLog()[0])).toEqual([
      {prop: 'capacityPerWeek', before: 10000, after: 4000},
    ]);
  });
});
