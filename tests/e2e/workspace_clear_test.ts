/**
 * @fileoverview End-to-end workspace clear through the gateway: a loaded
 * scenario blocks loading another one (409); POST /workspace/clear returns
 * the workspace to the blank template (objects, links, ontology, cockpit,
 * scenarios and pending recommendations gone; quotas and the action audit
 * kept); then a different scenario loads.
 */

import {describe, expect, it} from 'vitest';
import {createSystem, rowsOf, signUp} from './harness';

describe('workspace clear', () => {
  it('switches scenarios through a clear back to the blank template', async () => {
    const sys = await createSystem();
    const owner = await signUp(sys, 'clear@example.com');
    const api = <T = Record<string, unknown>>(
      method: string,
      path: string,
      body?: unknown,
    ) => sys.api<T>(method, path, {token: owner.token, body});

    expect(
      (
        await api('POST', '/workspace/sample-data', {
          scenarioId: 'supply-chain',
        })
      ).status,
    ).toBe(202);
    await sys.drain();
    const before = await api<{kpis: unknown[]; alerts: unknown[]}>(
      'GET',
      '/situation/overview?range=24h',
    );
    expect(before.body.kpis.length).toBeGreaterThan(0);
    expect(before.body.alerts.length).toBeGreaterThan(0);

    const suppliers = await api<{items: {rid: string}[]}>(
      'GET',
      '/objects?type=Supplier&limit=1',
    );
    const focus = suppliers.body.items[0].rid;
    const scenario = await api<{id: string}>('POST', '/scenarios', {
      perturbations: [{rid: focus, property: 'capacity', change: -0.5}],
    });
    expect(scenario.status).toBe(201);
    expect(
      (
        await api('POST', '/recommendations', {
          focus,
          scenarioId: scenario.body.id,
        })
      ).status,
    ).toBe(201);

    // Another scenario needs an empty workspace.
    const blocked = await api<{code: string}>(
      'POST',
      '/workspace/sample-data',
      {
        scenarioId: 'energy-grid',
      },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CONFLICT');

    const cleared = await api('POST', '/workspace/clear');
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({
      objects: 80,
      links: 160,
      scenarios: 1,
      recommendations: 1,
      mappings: 0,
    });
    for (const t of ['og_object', 'og_link', 'og_prop_index', 'domain_event']) {
      expect(await rowsOf(sys.dbs.objects, t, owner.tid), t).toBe(0);
    }
    // The clear itself is audited; nothing else of the audit is lost.
    expect(await rowsOf(sys.dbs.objects, 'og_action_log', owner.tid)).toBe(1);

    const ontology = await api<{templateId: string; objectTypes: unknown[]}>(
      'GET',
      '/ontology',
    );
    expect(ontology.body.templateId).toBe('blank');
    const after = await api<{
      kpis: unknown[];
      alerts: unknown[];
      pendingRecommendations: unknown[];
      quotas: Record<string, {used: number}>;
    }>('GET', '/situation/overview?range=24h');
    expect(after.body).toMatchObject({
      kpis: [],
      alerts: [],
      pendingRecommendations: [],
    });
    expect(after.body.quotas.objects.used).toBe(0);
    expect(
      (await api<{items: unknown[]}>('GET', '/recommendations')).body.items,
    ).toEqual([]);

    // Idempotent.
    expect((await api('POST', '/workspace/clear')).body).toMatchObject({
      objects: 0,
      links: 0,
    });

    const next = await api('POST', '/workspace/sample-data', {
      scenarioId: 'energy-grid',
    });
    expect(next.status).toBe(202);
    expect(await rowsOf(sys.dbs.objects, 'og_object', owner.tid)).toBe(26);
    expect(
      (await api<{templateId: string}>('GET', '/ontology')).body.templateId,
    ).toBe('energy-grid');
    await sys.drain();
    expect(sys.deadLetters()).toBe(0);
    const energy = await api<{kpis: unknown[]}>(
      'GET',
      '/situation/overview?range=24h',
    );
    expect(energy.body.kpis.length).toBeGreaterThan(0);
  });
});
