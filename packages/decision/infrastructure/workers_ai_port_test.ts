/**
 * @fileoverview Contract tests of the Workers AI adapter (reply shapes,
 * inputs per model, timeout).
 */

import {describe, expect, it} from 'vitest';
import {AI_MODELS, AppError} from '@ontodecide/shared-kernel';
import {FakeWorkersAi} from '@ontodecide/testing';
import type {AiRequest} from '../application';
import {
  extractOutput,
  extractUsage,
  fallbackInput,
  primaryInput,
  WorkersAiPort,
} from './workers_ai_port';

/** Shape of the Workers AI inputs inspected by the tests. */
interface AiInput {
  messages: {role: string; content: string}[];
  response_format: {type: string; json_schema?: unknown};
  chat_template_kwargs?: unknown;
  max_tokens?: number;
  reasoning?: unknown;
  max_output_tokens?: number;
  input?: string;
  instructions?: string;
}

const req: AiRequest = {
  model: AI_MODELS.primary,
  role: 'primary',
  system: 'SYS',
  user: 'USER',
  jsonSchema: {type: 'object'},
  maxTokens: 1000,
  timeoutMs: 50,
};

describe('extractOutput', () => {
  const obj = {ranking: ['c1']};
  it.each([
    ['chat string', {response: '{"ranking":["c1"]}'}, '{"ranking":["c1"]}'],
    ['chat object', {response: obj}, obj],
    [
      'tool call',
      {tool_calls: [{name: 'f', arguments: JSON.stringify(obj)}]},
      obj,
    ],
    ['tool call object', {tool_calls: [{name: 'f', arguments: obj}]}, obj],
    ['openai choices', {choices: [{message: {content: 'txt'}}]}, 'txt'],
    [
      'openai tool call',
      {
        choices: [
          {
            message: {
              tool_calls: [{function: {arguments: '{"ranking":["c1"]}'}}],
            },
          },
        ],
      },
      obj,
    ],
    [
      'responses message',
      {
        output: [
          {type: 'reasoning'},
          {
            type: 'message',
            content: [{type: 'output_text', text: 'a'}, {text: 'b'}],
          },
        ],
      },
      'ab',
    ],
    ['responses output_text', {output_text: 'x'}, 'x'],
    ['plain string', 'raw', 'raw'],
    ['unknown', {foo: 1}, undefined],
  ])('%s', (_n, reply, expected) => {
    expect(extractOutput(reply)).toEqual(expected);
  });

  it('reads usage in both namings', () => {
    expect(
      extractUsage({usage: {prompt_tokens: 1, completion_tokens: 2}}),
    ).toEqual({
      inputTokens: 1,
      outputTokens: 2,
    });
    expect(extractUsage({usage: {input_tokens: 3, output_tokens: 4}})).toEqual({
      inputTokens: 3,
      outputTokens: 4,
    });
    expect(extractUsage({})).toBeUndefined();
  });
});

describe('inputs', () => {
  it('primary: thinking off, JSON schema, token cap', () => {
    const i = primaryInput(req, true) as unknown as AiInput;
    expect(i.messages[0]).toEqual({role: 'system', content: 'SYS'});
    expect(i.messages[1].content).toBe('USER\n/no_think');
    expect(i.response_format).toEqual({
      type: 'json_schema',
      json_schema: {type: 'object'},
    });
    expect(i.chat_template_kwargs).toEqual({enable_thinking: false});
    expect(i.max_tokens).toBe(1000);
    expect(primaryInput(req, false)).not.toHaveProperty('chat_template_kwargs');
  });

  it('fallback: reasoning effort low, 1000 tokens', () => {
    const i = fallbackInput({...req, role: 'fallback'}) as unknown as AiInput;
    expect(i.reasoning).toEqual({effort: 'low'});
    expect(i.max_output_tokens).toBe(1000);
    expect(i.input).toBe('USER');
    expect(i.instructions).toContain('SYS');
  });
});

describe('WorkersAiPort', () => {
  it('returns output and usage', async () => {
    const ai = new FakeWorkersAi().script(AI_MODELS.primary, {
      response: {ranking: ['c1']},
      usage: {prompt_tokens: 10, completion_tokens: 5},
    });
    const port = new WorkersAiPort(ai.asAi() as never);
    expect(await port.complete(req)).toEqual({
      output: {ranking: ['c1']},
      usage: {inputTokens: 10, outputTokens: 5},
    });
  });

  it('times out', async () => {
    const ai = new FakeWorkersAi().script(
      AI_MODELS.primary,
      () => new Promise(() => {}),
    );
    const port = new WorkersAiPort(ai.asAi() as never);
    await expect(port.complete(req)).rejects.toSatisfy(
      (e: unknown) => AppError.from(e).code === 'UNAVAILABLE',
    );
  });

  it('propagates model errors', async () => {
    const port = new WorkersAiPort(new FakeWorkersAi().asAi() as never);
    await expect(
      port.complete({...req, role: 'fallback', model: AI_MODELS.fallback}),
    ).rejects.toThrow(/unavailable/);
  });
});
