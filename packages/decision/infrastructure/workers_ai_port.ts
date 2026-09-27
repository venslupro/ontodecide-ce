/**
 * @fileoverview AiPort over the Workers AI binding (修订说明书 12.6). Only
 * Workers AI native models, no AI Gateway, no external LLMs; prompts are
 * never stored or logged.
 *
 * - Primary (`@cf/qwen/qwen3-30b-a3b-fp8`): thinking disabled (`/no_think`
 *   plus `chat_template_kwargs.enable_thinking = false`; when the model
 *   rejects that argument it is dropped for the rest of the isolate) and
 *   JSON-Schema constrained output via `response_format`.
 * - Fallback (`@cf/openai/gpt-oss-20b`): Responses-style input with
 *   `reasoning.effort = low` and 1,000 output tokens.
 *
 * Replies are normalized from the chat (`response`, string or object),
 * tool-call (`tool_calls[].arguments`), OpenAI-compatible (`choices[]`)
 * and Responses (`output[]` / `output_text`) shapes. Calls time out after
 * `timeoutMs` (8 s).
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {AiCompletion, AiPort, AiRequest} from '../application';
import type {TokenUsage} from '../domain';

/** Minimal Workers AI binding surface. */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

const THINKING_ARG = /chat_template_kwargs|enable_thinking/i;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseArgs(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Extracts the model output (object or text) from any known reply shape. */
export function extractOutput(reply: unknown): unknown {
  if (typeof reply === 'string') return reply;
  if (!isObj(reply)) return undefined;
  const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls : undefined;
  if (calls?.length) {
    const c = calls[0] as Obj;
    const fn = isObj(c.function) ? c.function : c;
    return parseArgs(fn.arguments);
  }
  if (reply.response !== undefined && reply.response !== null) {
    return reply.response;
  }
  if (Array.isArray(reply.choices) && reply.choices.length) {
    const msg = (reply.choices[0] as Obj).message as Obj | undefined;
    const tc = Array.isArray(msg?.tool_calls) ? msg!.tool_calls : undefined;
    if (tc?.length) {
      const fn = (tc[0] as Obj).function as Obj | undefined;
      return parseArgs(fn?.arguments);
    }
    return msg?.content;
  }
  if (typeof reply.output_text === 'string') return reply.output_text;
  if (Array.isArray(reply.output)) {
    for (const item of reply.output as Obj[]) {
      if (item?.type === 'function_call') return parseArgs(item.arguments);
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
      const text = (item.content as Obj[])
        .map(c => (typeof c.text === 'string' ? c.text : ''))
        .join('');
      if (text) return text;
    }
  }
  return undefined;
}

/** Token usage from `usage` in chat or Responses naming. */
export function extractUsage(reply: unknown): TokenUsage | undefined {
  if (!isObj(reply) || !isObj(reply.usage)) return undefined;
  const u = reply.usage;
  const input = Number(u.prompt_tokens ?? u.input_tokens);
  const output = Number(u.completion_tokens ?? u.output_tokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return {inputTokens: input, outputTokens: output};
}

/** Workers AI implementation of {@link AiPort}. */
export class WorkersAiPort implements AiPort {
  private thinkingArg = true;

  constructor(private readonly ai: AiBinding) {}

  async complete(req: AiRequest): Promise<AiCompletion> {
    const reply =
      req.role === 'primary'
        ? await this.primary(req)
        : await this.withTimeout(
            this.ai.run(req.model, fallbackInput(req)),
            req,
          );
    return {output: extractOutput(reply), usage: extractUsage(reply)};
  }

  private async primary(req: AiRequest): Promise<unknown> {
    try {
      return await this.withTimeout(
        this.ai.run(req.model, primaryInput(req, this.thinkingArg)),
        req,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!this.thinkingArg || !THINKING_ARG.test(msg)) throw e;
      this.thinkingArg = false;
      return this.withTimeout(
        this.ai.run(req.model, primaryInput(req, false)),
        req,
      );
    }
  }

  private withTimeout<T>(p: Promise<T>, req: AiRequest): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AppError('UNAVAILABLE', `AI timeout ${req.model}`)),
        req.timeoutMs,
      );
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }
}

/** Input of the primary (qwen3) call. */
export function primaryInput(req: AiRequest, thinkingArg: boolean): Obj {
  return {
    messages: [
      {role: 'system', content: req.system},
      {role: 'user', content: `${req.user}\n/no_think`},
    ],
    response_format: {type: 'json_schema', json_schema: req.jsonSchema},
    max_tokens: req.maxTokens,
    temperature: 0.2,
    ...(thinkingArg ? {chat_template_kwargs: {enable_thinking: false}} : {}),
  };
}

/** Input of the fallback (gpt-oss-20b) call. */
export function fallbackInput(req: AiRequest): Obj {
  return {
    instructions: `${req.system}\nJSON schema: ${JSON.stringify(req.jsonSchema)}`,
    input: req.user,
    reasoning: {effort: 'low'},
    max_output_tokens: req.maxTokens,
  };
}
