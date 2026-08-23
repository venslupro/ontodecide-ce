/**
 * Environment bindings for the AI Service.
 */
import type { BaseEnv } from '@ontodecide/shared';

export interface AiEnv extends BaseEnv {
  /** Cloudflare Workers AI binding (system-mandatory, fallback provider). */
  AI: Ai;
  /** D1 for decision/recommendation/agent_run tables. */
  DB: D1Database;
  /** Durable Object namespace for the planning agent. */
  AGENT: DurableObjectNamespace;
  /** Cloudflare AI Gateway id — all LLM access routes through it. */
  AI_GATEWAY_ID: string;
  /** Workers AI model id, e.g. `@cf/meta/llama-3-8b-instruct`. */
  WORKERS_AI_MODEL: string;
  /** Default model ids for each third-party provider. */
  GOOGLE_MODEL: string;
  GROQ_MODEL: string;
  /** API keys for third-party providers (optional, set as secrets). */
  GOOGLE_API_KEY?: string;
  GROQ_API_KEY?: string;
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
