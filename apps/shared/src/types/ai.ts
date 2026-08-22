/**
 * AI-domain types shared between AI Service, Gateway and frontend clients.
 */

/** Identifier for a supported LLM provider. */
export type LlmProvider = 'workers-ai' | 'openai' | 'anthropic' | 'google' | 'openrouter';

/** Options passed to an `ILLMProvider.generate` call. */
export interface LlmOptions {
  /** Override the default provider for this call. */
  provider?: LlmProvider;
  /** Override the default model id. */
  model?: string;
  /** Sampling temperature, 0..1. */
  temperature?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** System prompt prepended to the user prompt. */
  systemPrompt?: string;
  /** Whether to stream the response (provider-dependent). */
  stream?: boolean;
}

/** Token usage reported by the provider. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Normalized LLM response returned by every provider adapter. */
export interface LlmResponse {
  content: string;
  usage: TokenUsage;
  /** Provider that actually served the call. */
  provider: LlmProvider;
  /** Model id that produced the response. */
  model: string;
}

/** Three-point scenario synthesis requested by the analyst. */
export type ScenarioTone = 'optimistic' | 'pessimistic' | 'neutral';

/** Output of the scenario-simulation feature. */
export interface ScenarioResult {
  tenant_id: string;
  /** Topic or question the scenario was generated for. */
  topic: string;
  scenarios: Array<{
    tone: ScenarioTone;
    narrative: string;
    keyFactors: string[];
    probability: number;
  }>;
  generatedAt: string;
  provider: LlmProvider;
}

/** Structured recommendation produced by the decision service. */
export interface Recommendation {
  id: string;
  tenant_id: string;
  topic: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  rationale: string;
  steps: Array<{
    order: number;
    action: string;
    expectedOutcome: string;
  }>;
  generatedAt: string;
  provider: LlmProvider;
}

/** Lifecycle status of a planning-agent task. */
export type AgentTaskStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'skipped';

/** A single task planned by the autonomous agent. */
export interface AgentTask {
  id: string;
  description: string;
  status: AgentTaskStatus;
  result?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** State persisted in the PlanningAgent Durable Object. */
export interface AgentState {
  goal: string;
  tasks: AgentTask[];
  status: 'idle' | 'planning' | 'executing' | 'reflecting' | 'done';
  createdAt: string;
  updatedAt: string;
}
