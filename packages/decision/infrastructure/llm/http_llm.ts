/**
 * @fileoverview Gemini (REST) and Groq (OpenAI-compatible) adapters with
 * injectable fetch. External providers receive redacted prompts only.
 */

import type {LlmCompletion, LlmOptions, LlmPort} from '../../application';
import {
  isRetryableStatus,
  LLM_TIMEOUT_MS,
  LlmProviderError,
  withTimeout,
} from './llm_error';

/** fetch signature accepted by the adapters. */
export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Default Gemini model. */
export const GEMINI_MODEL = 'gemini-2.5-flash';

/** Default Groq model. */
export const GROQ_MODEL = 'openai/gpt-oss-20b';

async function postJson(
  provider: string,
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const res = await withTimeout(timeoutMs, provider, signal =>
    fetchFn(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', ...headers},
      body: JSON.stringify(body),
      signal,
    }),
  );
  const text = await res.text();
  if (!res.ok) {
    throw new LlmProviderError(
      `${provider} HTTP ${res.status}`,
      isRetryableStatus(res.status, text),
      res.status,
      provider,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmProviderError(
      `${provider} returned invalid JSON`,
      true,
      502,
      provider,
    );
  }
}

/** Google Gemini `generateContent` adapter. */
export class GeminiLlm implements LlmPort {
  readonly family: string;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly model: string = GEMINI_MODEL,
    private readonly timeoutMs: number = LLM_TIMEOUT_MS,
  ) {
    this.family = `gemini:${model}`;
  }

  async complete(
    prompt: string,
    opts: LlmOptions = {},
  ): Promise<LlmCompletion> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const out = (await postJson(
      'gemini',
      this.fetchFn,
      url,
      {},
      {
        ...(opts.system
          ? {systemInstruction: {parts: [{text: opts.system}]}}
          : {}),
        contents: [{role: 'user', parts: [{text: prompt}]}],
        generationConfig: {
          temperature: opts.temperature ?? 0.2,
          maxOutputTokens: opts.maxTokens ?? 800,
          ...(opts.json ? {responseMimeType: 'application/json'} : {}),
        },
      },
      this.timeoutMs,
    )) as {candidates?: {content?: {parts?: {text?: string}[]}}[]};
    const text = (out.candidates?.[0]?.content?.parts ?? [])
      .map(p => p.text ?? '')
      .join('');
    if (!text)
      throw new LlmProviderError(
        'gemini returned no text',
        true,
        502,
        'gemini',
      );
    // External provider: no Workers AI neurons consumed.
    return {text, model: this.model, neurons: 0};
  }
}

/** Groq chat-completions adapter (OpenAI compatible). */
export class GroqLlm implements LlmPort {
  readonly family: string;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly model: string = GROQ_MODEL,
    private readonly timeoutMs: number = LLM_TIMEOUT_MS,
  ) {
    this.family = `groq:${model}`;
  }

  async complete(
    prompt: string,
    opts: LlmOptions = {},
  ): Promise<LlmCompletion> {
    const out = (await postJson(
      'groq',
      this.fetchFn,
      'https://api.groq.com/openai/v1/chat/completions',
      {authorization: `Bearer ${this.apiKey}`},
      {
        model: this.model,
        messages: [
          ...(opts.system ? [{role: 'system', content: opts.system}] : []),
          {role: 'user', content: prompt},
        ],
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 800,
        ...(opts.json ? {response_format: {type: 'json_object'}} : {}),
      },
      this.timeoutMs,
    )) as {choices?: {message?: {content?: string}}[]};
    const text = out.choices?.[0]?.message?.content ?? '';
    if (!text)
      throw new LlmProviderError('groq returned no text', true, 502, 'groq');
    return {text, model: this.model, neurons: 0};
  }
}
