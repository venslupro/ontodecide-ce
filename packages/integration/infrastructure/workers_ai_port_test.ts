/**
 * @fileoverview Tests for the Workers AI adapter.
 */

import {FakeWorkersAi} from '@ontodecide/testing';
import {describe, expect, it} from 'vitest';
import {extractJson, WorkersAiPort} from './workers_ai_port';

const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const REQ = {
  targetType: 'Supplier',
  fields: [{name: 'volume', samples: ['1200']}],
  props: [{apiName: 'capacity', dataType: 'double', label: 'Capacity'}],
};

describe('WorkersAiPort', () => {
  it('extracts JSON from the common response shapes', () => {
    expect(extractJson({response: {a: 1}})).toEqual({a: 1});
    expect(extractJson({response: '<think>x</think> {"a":2}'})).toEqual({a: 2});
    expect(
      extractJson({choices: [{message: {content: '```json\n{"a":3}\n```'}}]}),
    ).toEqual({a: 3});
    expect(() => extractJson({response: 'nothing'})).toThrow();
  });

  it('calls the model without thinking and a JSON schema', async () => {
    const ai = new FakeWorkersAi().script(MODEL, {
      response: {mappings: [{from: 'volume', to: 'capacity'}]},
    });
    const res = await new WorkersAiPort(ai, MODEL).suggestMappings(REQ);
    expect(res).toEqual({
      pairs: [{from: 'volume', to: 'capacity'}],
      neurons: null,
    });
    const input = ai.calls[0].input as Record<string, unknown>;
    expect(input.response_format).toMatchObject({type: 'json_schema'});
    expect(input.chat_template_kwargs).toEqual({enable_thinking: false});
    expect(JSON.stringify(input.messages)).toContain('/no_think');
  });

  it('rejects malformed output and times out', async () => {
    const bad = new FakeWorkersAi().script(MODEL, {response: {mappings: [1]}});
    await expect(
      new WorkersAiPort(bad, MODEL).suggestMappings(REQ),
    ).rejects.toThrow();
    const slow = new FakeWorkersAi().script(
      MODEL,
      () =>
        new Promise(r => setTimeout(() => r({response: {mappings: []}}), 100)),
    );
    await expect(
      new WorkersAiPort(slow, MODEL, 10).suggestMappings(REQ),
    ).rejects.toThrow(/timeout/);
  });
});
