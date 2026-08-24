/**
 * Planning-agent resource (AI service).
 *
 * Covers the three agent routes: submit a new goal for planning, poll the
 * agent's state, and trigger a manual reflection pass. State is persisted
 * in a Durable Object keyed by {@code id}.
 */
import { httpGet, httpPost } from './client';
import type {
  AgentPlanRequestDto,
  AgentState,
  ApiResponse,
} from '@ontodecide/shared';

/** {@code POST /api/ai/agent/plan} — start a new planning agent run. */
export async function plan(
  body: AgentPlanRequestDto,
): Promise<ApiResponse<AgentState>> {
  return httpPost<AgentState>('/api/ai/agent/plan', body);
}

/** {@code GET /api/ai/agent/{id}} — read current state. */
export async function get(
  id: string,
): Promise<ApiResponse<AgentState>> {
  return httpGet<AgentState>(`/api/ai/agent/${encodeURIComponent(id)}`);
}

/** {@code POST /api/ai/agent/{id}/reflect} — force reflection step. */
export async function reflect(
  id: string,
): Promise<ApiResponse<AgentState>> {
  return httpPost<AgentState>(
    `/api/ai/agent/${encodeURIComponent(id)}/reflect`,
  );
}
