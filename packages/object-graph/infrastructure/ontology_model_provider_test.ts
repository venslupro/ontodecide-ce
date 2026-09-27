/**
 * @fileoverview Tests of the per-request schema memo over OntologyRpc.
 */

import {describe, expect, it} from 'vitest';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import {testCtx} from '@ontodecide/testing';
import {OntologySchemaProvider} from './ontology_model_provider';

describe('OntologySchemaProvider', () => {
  it('asks ontology-manager once per call context', async () => {
    let calls = 0;
    const provider = new OntologySchemaProvider({
      getCompiledSchema: async () => {
        calls++;
        return {etag: calls} as unknown as CompiledSchema;
      },
    });
    const ctx = testCtx();
    await provider.get(ctx);
    await provider.get(ctx);
    expect(calls).toBe(1);
    await provider.get(testCtx());
    expect(calls).toBe(2);
  });

  it('does not cache failures', async () => {
    let fail = true;
    const provider = new OntologySchemaProvider({
      getCompiledSchema: async () => {
        if (fail) throw new Error('down');
        return {} as CompiledSchema;
      },
    });
    const ctx = testCtx();
    await expect(provider.get(ctx)).rejects.toThrow('down');
    fail = false;
    await expect(provider.get(ctx)).resolves.toEqual({});
  });
});
