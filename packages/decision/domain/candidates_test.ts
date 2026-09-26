/**
 * @fileoverview Tests for candidate action generation.
 */

import {describe, expect, it} from 'vitest';
import {
  buildCandidate,
  buildCandidates,
  candidateSlots,
  rankCandidates,
  suggestKey,
  suggestRequests,
} from './candidates';
import {propagate} from './propagation';
import {
  rid,
  subgraph,
  supplyChainGraph,
  supplyChainModel,
} from './testing/supply_chain_fixture';

const model = supplyChainModel();
const s1 = rid('Supplier', 'S-001');
const slice = subgraph(supplyChainGraph(), [s1], ['supplies', 'usedIn']);
const impact = propagate(slice, model.linkTypes, [
  {rid: s1, property: 'capacity', change: -0.6},
]);

describe('candidateSlots', () => {
  it('targets affected objects of each action target type plus the focus', () => {
    const slots = candidateSlots(model, slice, impact, s1);
    const pairs = slots.map(
      s => `${s.def.apiName}:${s.target.rid.split('.')[3]}`,
    );
    expect(pairs).toEqual([
      'flagSupplier:S-001',
      'increaseSafetyStock:P-900',
      'increaseSafetyStock:P-901',
      'switchSupplier:M-100',
      'switchSupplier:M-101',
    ]);
  });
});

describe('suggestRequests', () => {
  it('excludes currently impacted objects of the suggested type', () => {
    const slots = candidateSlots(model, slice, impact, s1);
    const reqs = suggestRequests(slots, slice, impact);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].key).toBe(suggestKey('switchSupplier', 'newSupplier'));
    expect(reqs[0].exclude).toEqual([s1]);
    expect(reqs[0].suggest.orderBy).toEqual({prop: 'riskScore', dir: 'asc'});
  });
});

describe('buildCandidate', () => {
  const slots = candidateSlots(model, slice, impact, s1);
  const byType = (t: string) => slots.find(s => s.def.apiName === t)!;

  it('prefills suggested object references', () => {
    const c = buildCandidate(
      byType('switchSupplier'),
      {'switchSupplier.newSupplier': [rid('Supplier', 'S-005')]},
      'zh-CN',
    );
    expect(c).toMatchObject({
      actionType: 'switchSupplier',
      target: rid('Material', 'M-100'),
      targetTitle: 'Aluminium housing',
      params: {newSupplier: rid('Supplier', 'S-005')},
      requiresApproval: true,
      eligible: true,
    });
  });

  it('is ineligible when a required parameter cannot be filled', () => {
    const c = buildCandidate(byType('switchSupplier'), {}, 'en-US');
    expect(c.eligible).toBe(false);
    expect(c.unmetPreconditions?.[0]).toMatch(
      /Missing parameter: New supplier/,
    );
  });

  it('prefills defaults and evaluates preconditions on {target, params}', () => {
    const c = buildCandidate(byType('increaseSafetyStock'), {}, 'zh-CN');
    expect(c.params).toEqual({days: 7});
    expect(c.eligible).toBe(true);
    const bad = buildCandidate(
      {
        ...byType('increaseSafetyStock'),
        def: {
          ...byType('increaseSafetyStock').def,
          parameters: [
            {
              apiName: 'days',
              displayName: 'd',
              dataType: 'integer',
              defaultValue: 40,
            },
          ],
        },
      },
      {},
      'en-US',
    );
    expect(bad.eligible).toBe(false);
    expect(bad.unmetPreconditions).toEqual([
      'Extra days must be between 1 and 30',
    ]);
  });

  it('uses target props in preconditions', () => {
    const slot = byType('flagSupplier');
    const suspended = {
      ...slot,
      target: {
        ...slot.target,
        props: {...slot.target.props, status: 'suspended'},
      },
    };
    expect(buildCandidate(slot, {}, 'zh-CN').eligible).toBe(true);
    const c = buildCandidate(suspended, {}, 'zh-CN');
    expect(c.eligible).toBe(false);
    expect(c.unmetPreconditions).toEqual(['已停用的供应商不能标记']);
  });

  it('never suggests the target itself', () => {
    const slot = byType('switchSupplier');
    const c = buildCandidate(
      slot,
      {
        'switchSupplier.newSupplier': [
          slot.target.rid,
          rid('Supplier', 'S-003'),
        ],
      },
      'zh-CN',
    );
    expect(c.params.newSupplier).toBe(rid('Supplier', 'S-003'));
  });
});

describe('rankCandidates', () => {
  it('keeps eligible candidates ordered by expected impact', () => {
    const slots = candidateSlots(model, slice, impact, s1);
    const cands = buildCandidates(slots, {}, 'zh-CN').map((c, i) => ({
      ...c,
      expectedImpact: i / 10,
    }));
    const ranked = rankCandidates(cands);
    expect(ranked.every(c => c.eligible)).toBe(true);
    expect(ranked.map(c => c.actionType)).not.toContain('switchSupplier');
    expect(ranked[0].expectedImpact).toBeGreaterThanOrEqual(
      ranked[ranked.length - 1].expectedImpact,
    );
  });
});
