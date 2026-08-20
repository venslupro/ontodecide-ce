/**
 * DTOs for the AI scenario / recommendation features.
 */
import type {LlmProvider, ScenarioTone} from '../types/ai.js';

/** Request body for `POST /api/ai/scenario`. */
export interface ScenarioRequestDto {
  /** Free-form topic or question to simulate. */
  topic: string;
  /** Optional context bundle (entity summaries, prior decisions). */
  context?: string;
  /** Tones to generate; defaults to all three. */
  tones?: ScenarioTone[];
  /** Optional provider override. */
  provider?: LlmProvider;
}

/** Request body for `POST /api/ai/recommend`. */
export interface RecommendationRequestDto {
  topic: string;
  /** Historical reference text the model should reason from. */
  history?: string;
  provider?: LlmProvider;
}

/** Request body for `POST /api/ai/agent/plan`. */
export interface AgentPlanRequestDto {
  goal: string;
  provider?: LlmProvider;
}
