/**
 * @fileoverview Runs the LlmPort contract suite against FakeLlm, Workers
 * AI, Gemini and Groq adapters, and tests the provider chain.
 */

import {describe, expect, it} from 'vitest';
import {FetchMock} from '@ontodecide/testing';
import {silentLogger} from '@ontodecide/shared-kernel';
import {buildLlmChain, ChainLlm} from './chain_llm';
import {FakeLlm} from './fake_llm';
import {GeminiLlm, GroqLlm} from './http_llm';
import {LlmProviderError} from './llm_error';
import {
  describeLlmPortContract,
  type LlmContractScenario,
} from './llm_port_contract';
import {WorkersAiLlm, workersAiText, type AiRunner} from './workers_ai_llm';

const never = () => new Promise<Response>(() => {});

function httpMock(
  s: LlmContractScenario,
  body: (text: string) => unknown,
): FetchMock {
  return new FetchMock(() => {
    if (s.kind === 'hang') return never();
    if (s.kind === 'status')
      return new Response('{"error":"x"}', {status: s.status});
    return new Response(JSON.stringify(body(s.text)), {status: 200});
  });
}

describeLlmPortContract('FakeLlm', s => {
  if (s.kind === 'reply') {
    const llm = new FakeLlm({replies: [s.text]});
    return {llm, lastRequest: () => JSON.stringify(llm.calls.at(-1))};
  }
  const status = s.kind === 'status' ? s.status : 408;
  return {
    llm: new FakeLlm({
      replies: [
        new LlmProviderError(
          `HTTP ${status}`,
          status === 429 || status >= 500,
          status,
        ),
      ],
    }),
  };
});

describeLlmPortContract(
  'WorkersAiLlm',
  s => {
    let last = '';
    const ai: AiRunner = {
      run: async (_model, inputs) => {
        last = JSON.stringify(inputs);
        if (s.kind === 'hang') return new Promise(() => {});
        if (s.kind === 'status')
          throw new Error(`${s.status}: capacity exceeded`);
        return {choices: [{message: {content: s.text}}]};
      },
    };
    return {llm: new WorkersAiLlm(ai, undefined, 20), lastRequest: () => last};
  },
  {supportsTimeout: true},
);

describeLlmPortContract(
  'GeminiLlm',
  s => {
    const mock = httpMock(s, text => ({
      candidates: [{content: {parts: [{text}]}}],
    }));
    return {
      llm: new GeminiLlm('KEY', mock.fetch, undefined, 20),
      lastRequest: () => mock.calls.at(-1)?.body ?? '',
    };
  },
  {supportsTimeout: true},
);

describeLlmPortContract(
  'GroqLlm',
  s => {
    const mock = httpMock(s, text => ({choices: [{message: {content: text}}]}));
    return {
      llm: new GroqLlm('KEY', mock.fetch, undefined, 20),
      lastRequest: () => mock.calls.at(-1)?.body ?? '',
    };
  },
  {supportsTimeout: true},
);

describe('HTTP adapters', () => {
  it('Gemini calls generateContent with the key and JSON mode', async () => {
    const mock = new FetchMock(
      () =>
        new Response(
          JSON.stringify({candidates: [{content: {parts: [{text: '{}'}]}}]}),
        ),
    );
    await new GeminiLlm('K 1', mock.fetch).complete('p', {json: true});
    expect(mock.calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=K%201',
    );
    expect(
      JSON.parse(mock.calls[0].body).generationConfig.responseMimeType,
    ).toBe('application/json');
  });

  it('Groq calls the OpenAI-compatible endpoint with a bearer token', async () => {
    const mock = new FetchMock(
      () =>
        new Response(JSON.stringify({choices: [{message: {content: '{}'}}]})),
    );
    const out = await new GroqLlm('gk', mock.fetch).complete('p', {json: true});
    expect(mock.calls[0].url).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
    expect(mock.calls[0].headers.authorization).toBe('Bearer gk');
    expect(JSON.parse(mock.calls[0].body).response_format).toEqual({
      type: 'json_object',
    });
    expect(out.neurons).toBe(0);
  });

  it('treats quota errors in a 403 body as retryable', async () => {
    const mock = new FetchMock(
      () =>
        new Response(
          '{"error":{"status":"RESOURCE_EXHAUSTED","message":"quota"}}',
          {status: 403},
        ),
    );
    const err = await new GeminiLlm('k', mock.fetch)
      .complete('p')
      .catch((e: unknown) => e);
    expect((err as LlmProviderError).retryable).toBe(true);
  });
});

describe('workersAiText', () => {
  it('reads chat, legacy and Responses API shapes', () => {
    expect(workersAiText({response: 'a'})).toBe('a');
    expect(
      workersAiText({
        output: [
          {type: 'reasoning', content: [{type: 'reasoning_text', text: 'hmm'}]},
          {type: 'message', content: [{type: 'output_text', text: 'b'}]},
        ],
      }),
    ).toBe('b');
  });
});

describe('ChainLlm', () => {
  it('falls back to the next provider on 429', async () => {
    const first = new FakeLlm({
      model: 'a',
      replies: [new LlmProviderError('HTTP 429', true, 429)],
    });
    const second = new FakeLlm({model: 'b', replies: ['ok']});
    const chain = new ChainLlm(
      [
        {name: 'a', llm: first},
        {name: 'b', llm: second},
      ],
      silentLogger,
    );
    const out = await chain.complete('p');
    expect(out).toMatchObject({text: 'ok', model: 'b'});
    expect(first.calls).toHaveLength(1);
    expect(chain.family).toBe('chain:a,b');
  });

  it('throws when every provider fails', async () => {
    const chain = new ChainLlm(
      [{name: 'a', llm: new FakeLlm({replies: [new Error('boom')]})}],
      silentLogger,
    );
    await expect(chain.complete('p')).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('builds from LLM_CHAIN and skips providers without binding or key', async () => {
    const mock = new FetchMock(
      () =>
        new Response(
          JSON.stringify({choices: [{message: {content: 'from-groq'}}]}),
        ),
    );
    expect(
      buildLlmChain({
        chain: 'workers-ai,gemini',
        fetch: mock.fetch,
        logger: silentLogger,
      }),
    ).toBeNull();
    const chain = buildLlmChain({
      chain: 'workers-ai,gemini,groq',
      groqApiKey: 'k',
      fetch: mock.fetch,
      logger: silentLogger,
    });
    expect(chain?.family).toBe('chain:groq');
    expect((await chain!.complete('p')).text).toBe('from-groq');
  });

  it('switches from Workers AI to Gemini on timeout', async () => {
    const ai: AiRunner = {run: () => new Promise(() => {})};
    const mock = new FetchMock(
      () =>
        new Response(
          JSON.stringify({candidates: [{content: {parts: [{text: 'gem'}]}}]}),
        ),
    );
    const chain = buildLlmChain({
      ai,
      geminiApiKey: 'k',
      fetch: mock.fetch,
      logger: silentLogger,
      timeoutMs: 10,
    });
    expect(chain?.family).toBe('chain:workers-ai,gemini');
    expect((await chain!.complete('p')).text).toBe('gem');
  });
});
