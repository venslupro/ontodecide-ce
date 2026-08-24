/**
 * Resource-registry coverage test.
 *
 * Asserts that the client-side {@link RESOURCE_REGISTRY} in
 * {@code src/services/api/index.ts} exposes exactly 16 route-prefix keys,
 * each matching a hardcoded expected list. The hardcoded list mirrors the
 * Gateway's {@code ROUTES} + {@code PUBLIC_PREFIXES} prefix split so any
 * new backend route forces a client-module addition to be green.
 */
import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  PREFIXES_WITH_RESOURCE,
  RESOURCE_REGISTRY,
} from '../src/services/api/index';

/** 16 expected prefix strings (order independent). */
const EXPECTED_PREFIXES: readonly string[] = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/',
  '/api/applications',
  '/api/user',
  '/api/admin/users',
  '/api/admin/audit',
  '/api/admin/config',
  '/api/admin/cleanup',
  '/api/admin/cleanup/status/{taskId}',
  '/api/ontology',
  '/api/entities',
  '/api/situation',
  '/api/graph',
  '/api/ingest',
  '/api/ai/',
];

/**
 * Stable expected module names keyed by prefix. Matches the
 * {@code *Resource} module naming convention used by the registry.
 */
const EXPECTED_NAMES: Readonly<Record<string, string>> = {
  '/api/auth/login': 'auth',
  '/api/auth/refresh': 'auth',
  '/api/auth/': 'auth',
  '/api/applications': 'applications',
  '/api/user': 'user',
  '/api/admin/users': 'adminUsers',
  '/api/admin/audit': 'adminAudit',
  '/api/admin/config': 'adminConfig',
  '/api/admin/cleanup': 'adminCleanup',
  '/api/admin/cleanup/status/{taskId}': 'adminCleanup',
  '/api/ontology': 'ontology',
  '/api/entities': 'entities',
  '/api/situation': 'situation',
  '/api/graph': 'graph',
  '/api/ingest': 'ingestion',
  '/api/ai/': 'ai',
};

describe('resource registry coverage', () => {
  it('registers exactly 16 prefixes', () => {
    expect(PREFIXES_WITH_RESOURCE).toHaveLength(16);
    expect(Object.keys(RESOURCE_REGISTRY)).toHaveLength(16);
  });

  it('contains every expected prefix (no missing / no extras)', () => {
    const registryKeys = Object.keys(RESOURCE_REGISTRY).sort();
    const listKeys = [...PREFIXES_WITH_RESOURCE].sort();
    const expectedKeys = [...EXPECTED_PREFIXES].sort();
    expect(listKeys).toEqual(expectedKeys);
    expect(registryKeys).toEqual(expectedKeys);
  });

  it('assigns the expected module name to each prefix', () => {
    EXPECTED_PREFIXES.forEach((prefix) => {
      const entry = RESOURCE_REGISTRY[prefix as keyof typeof RESOURCE_REGISTRY];
      expect(entry, `missing entry for ${prefix}`).toBeDefined();
      expect(entry.name, `wrong name for ${prefix}`).toBe(
        EXPECTED_NAMES[prefix],
      );
    });
  });

  it('declares a non-empty functions list for each entry', () => {
    Object.entries(RESOURCE_REGISTRY).forEach(([prefix, entry]) => {
      expect(entry.functions.length, `empty functions for ${prefix}`).toBeGreaterThan(0);
      entry.functions.forEach((fn) => {
        expect(typeof (entry.module as Record<string, unknown>)[fn]).toBe(
          'function',
        );
      });
    });
  });
});
