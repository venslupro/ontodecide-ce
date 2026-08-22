/**
 * AI HTTP handlers.
 *
 *   POST /ai/scenario       — run scenario simulation
 *   POST /ai/recommend      — run recommendation
 *   POST /ai/agent/plan     — start an autonomous agent (returns agent id)
 *   GET  /ai/agent/:id      — fetch agent state
 *   POST /ai/agent/:id/reflect — trigger reflection
 *   GET  /ai/history        — list past decisions for the tenant
 */
import {
  ERROR_CODES,
  HEADERS,
  type Recommendation,
  type ScenarioResult,
  nowIso,
  throwError,
} from '@ontodecide/shared';
import {
  agentPlanRequestSchema,
  recommendationRequestSchema,
  scenarioRequestSchema,
} from '@ontodecide/shared';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { ScenarioService } from '../service/scenario.service.js';
import type { RecommendationService } from '../service/recommendation.service.js';
import type { ProviderFactory } from '../core/llm/provider.factory.js';
import type { IDecisionRepository } from '../repository/decision.repository.js';
import type { AiEnv } from '../types/env.js';

type ScenarioBody = z.infer<typeof scenarioRequestSchema>;
type RecommendationBody = z.infer<typeof recommendationRequestSchema>;
type AgentPlanBody = z.infer<typeof agentPlanRequestSchema>;

/** Extract the tenant id from the gateway-injected header. */
export function tenant(c: Context): string {
  const tid = c.req.header(HEADERS.TENANT_ID);
  if (!tid) {
    throwError(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.');
  }
  return tid;
}

/** POST /ai/scenario — returns the simulation result. */
export async function scenarioHandler(
  c: Context,
  body: ScenarioBody,
  service: ScenarioService,
  factory: ProviderFactory,
): Promise<ScenarioResult> {
  return service.simulate(
    {
      tenantId: tenant(c),
      topic: body.topic,
      context: body.context,
      tones: body.tones,
      provider: body.provider,
    },
    (id) => factory.get(id),
  );
}

/** POST /ai/recommend — returns the recommendation. */
export async function recommendHandler(
  c: Context,
  body: RecommendationBody,
  service: RecommendationService,
  factory: ProviderFactory,
): Promise<Recommendation> {
  return service.recommend(
    {
      tenantId: tenant(c),
      topic: body.topic,
      history: body.history,
      provider: body.provider,
    },
    (id) => factory.get(id),
  );
}

/** POST /ai/agent/plan — start an agent run. */
export async function startAgentHandler(
  c: Context,
  body: AgentPlanBody,
  env: AiEnv,
): Promise<{ agentId: string; status: string; startedAt: string }> {
  const tenantId = tenant(c);
  // Use the tenant id as the DO id so each tenant has a single agent
  // (replacing previous runs). For multi-agent, hash goal+timestamp.
  const agentId = env.AGENT.idFromName(tenantId);
  const stub = env.AGENT.get(agentId);
  await stub.fetch(`https://agent/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: body.goal, provider: body.provider }),
  });
  return { agentId: agentId.toString(), status: 'started', startedAt: nowIso() };
}

/** GET /ai/agent/:id — fetch agent state. */
export async function agentStateHandler(c: Context, env: AiEnv): Promise<unknown> {
  const agentName = c.req.param('id');
  if (!agentName) {
    throwError(ERROR_CODES.VALIDATION_FAILED, 'agent id is required.');
  }
  const id = env.AGENT.idFromName(agentName);
  const stub = env.AGENT.get(id);
  const upstream = await stub.fetch(`https://agent/state`);
  const body = (await upstream.json()) as { state?: unknown };
  return body.state ?? {};
}

/** POST /ai/agent/:id/reflect — trigger reflection. */
export async function reflectAgentHandler(c: Context, env: AiEnv): Promise<{ status: string }> {
  const agentName = c.req.param('id');
  if (!agentName) {
    throwError(ERROR_CODES.VALIDATION_FAILED, 'agent id is required.');
  }
  const id = env.AGENT.idFromName(agentName);
  const stub = env.AGENT.get(id);
  await stub.fetch(`https://agent/reflect`, { method: 'POST' });
  return { status: 'reflecting' };
}

/** GET /ai/history?kind=scenario&page=1&size=20 */
export async function historyHandler(
  c: Context,
  repo: IDecisionRepository,
): Promise<{
  total: number;
  page: number;
  size: number;
  list: Awaited<ReturnType<IDecisionRepository['listForTenant']>>['items'];
}> {
  const kind = c.req.query('kind') ?? undefined;
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const size = parseInt(c.req.query('size') ?? '20', 10);
  const offset = (page - 1) * size;
  const { total, items } = await repo.listForTenant(tenant(c), {
    kind,
    offset,
    limit: size,
  });
  return { total, page, size, list: items };
}

/** GET /ai/providers — list configured providers (debug endpoint). */
export async function providersHandler(
  factory: ProviderFactory,
): Promise<{ available: string[]; default: string }> {
  const available = factory.available();
  return { available, default: factory.get().id };
}
