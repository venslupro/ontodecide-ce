/**
 * @fileoverview Shared contract test suite every LlmPort implementation
 * must pass. Test-only (imports vitest); not exported from the index.
 */

import {describe, expect, it} from 'vitest';
import type {LlmPort} from '../../application';
import {LlmProviderError} from './llm_error';

/** Provider behaviour a factory must emulate. */
export type LlmContractScenario =
  | {kind: 'reply'; text: string}
  | {kind: 'status'; status: number}
  | {kind: 'hang'};

/** Builds an LlmPort whose backend behaves as described. */
export type LlmPortFactory = (scenario: LlmContractScenario) => {
  llm: LlmPort;
  /** Returns what the backend received for the last call (prompt visible). */
  lastRequest?: () => string;
};

/** Registers the contract suite for one implementation. */
export function describeLlmPortContract(
  name: string,
  factory: LlmPortFactory,
  opts: {supportsTimeout?: boolean} = {},
): void {
  describe(`LlmPort contract: ${name}`, () => {
    it('returns the provider text with a model id and a neuron count', async () => {
      const {llm} = factory({kind: 'reply', text: '{"ok":true}'});
      const out = await llm.complete('Say ok', {
        system: 'Be brief',
        json: true,
        maxTokens: 50,
      });
      expect(out.text).toBe('{"ok":true}');
      expect(typeof out.model).toBe('string');
      expect(out.model.length).toBeGreaterThan(0);
      expect(out.neurons).toBeGreaterThanOrEqual(0);
      expect(typeof llm.family).toBe('string');
      expect(llm.family.length).toBeGreaterThan(0);
    });

    it('sends the prompt and the system instruction', async () => {
      const {llm, lastRequest} = factory({kind: 'reply', text: 'x'});
      await llm.complete('PROMPT-123', {system: 'SYSTEM-456'});
      if (lastRequest) {
        expect(lastRequest()).toContain('PROMPT-123');
        expect(lastRequest()).toContain('SYSTEM-456');
      }
    });

    it('raises a retryable LlmProviderError on 429', async () => {
      const {llm} = factory({kind: 'status', status: 429});
      const err = await llm.complete('x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).retryable).toBe(true);
    });

    it('raises a retryable LlmProviderError on 5xx', async () => {
      const {llm} = factory({kind: 'status', status: 503});
      const err = await llm.complete('x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).retryable).toBe(true);
    });

    it('raises an LlmProviderError on other failures', async () => {
      const {llm} = factory({kind: 'status', status: 400});
      const err = await llm.complete('x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LlmProviderError);
    });

    if (opts.supportsTimeout) {
      it('times out with a retryable error', async () => {
        const {llm} = factory({kind: 'hang'});
        const err = await llm.complete('x').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(LlmProviderError);
        expect((err as LlmProviderError).retryable).toBe(true);
      });
    }
  });
}
