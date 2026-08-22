/**
 * Environment bindings for the AI Service.
 */
import type { BaseEnv } from '@ontodecide/shared';

export interface AiEnv extends BaseEnv {
  /** Cloudflare Workers AI binding. */
  AI: Ai;
  /** D1 for decision/recommendation/agent_run tables. */
  DB: D1Database;
  /** KV cache + neuron-budget counter. */
  CACHE: KVNamespace;
  /** Durable Object namespace for the planning agent. */
  AGENT: DurableObjectNamespace;
  /** Workers AI model id, e.g. `@cf/meta/llama-3-8b-instruct`. */
  WORKERS_AI_MODEL: string;
  /** AI Gateway id (optional, enables unified logging/cache). */
  AI_GATEWAY_ID?: string;
  /** AI Gateway auth token (optional, set as secret). */
  AI_GATEWAY_TOKEN?: string;
  /** Default model ids for each third-party provider. */
  OPENAI_MODEL: string;
  ANTHROPIC_MODEL: string;
  GOOGLE_MODEL: string;
  OPENROUTER_MODEL: string;
  /** API keys for third-party providers (set as secrets). */
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

/** D1 row shape returned by SELECT * FROM decisions. */
export interface DecisionRow {
  id: string;
  tenant_id: string;
  kind: 'scenario' | 'recommendation' | 'agent_plan';
  topic: string;
  provider: string;
  model: string | null;
  prompt_hash: string;
  payload: string;
  neuron_cost: number;
  created_at: string;
  metadata: string | null;
}

/** Cloudflare Workers AI runtime (declared by @cloudflare/workers-types). */
interface Ai {
  run(
    model: string,
    inputs: {
      messages?: unknown[];
      prompt?: string;
      stream?: boolean;
    },
  ): Promise<unknown>;
}
