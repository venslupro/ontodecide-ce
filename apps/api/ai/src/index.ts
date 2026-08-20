/**
 * AI Service Worker entry point.
 *
 * Wires up the LLM provider factory, neuron budget, repositories, services
 * and the HTTP handlers. The PlanningAgent Durable Object class is
 * re-exported so the Workers runtime can find it during deployment.
 */
import {
  ERROR_CODES,
  HEADERS,
  ok,
  agentPlanRequestSchema,
  agentStateSchema,
  recommendationRequestSchema,
  recommendationSchema,
  scenarioRequestSchema,
  scenarioResultSchema,
} from '@ontodecide/shared';
import {
  OpenAPIHono,
  createRoute,
  honoErrorHandler,
  internalOnlyMiddleware,
  jsonError,
  jsonFailResponse,
  jsonOk,
  jsonOkResponse,
} from '@ontodecide/shared/hono';
import {z} from 'zod';
import type {AiEnv} from './types/env.js';
import {PlanningAgent} from './core/agents/planning.agent.js';
import {ProviderFactory} from './core/llm/provider.factory.js';
import {NeuronBudgetManager} from './core/budget.service.js';
import {D1DecisionRepository} from './repository/decision.repository.js';
import {ScenarioService} from './service/scenario.service.js';
import {RecommendationService} from './service/recommendation.service.js';
import {
  agentStateHandler,
  historyHandler,
  providersHandler,
  recommendHandler,
  reflectAgentHandler,
  scenarioHandler,
  startAgentHandler,
} from './handlers/ai.js';

// Re-export the Durable Object class so Wrangler can register it.
export {PlanningAgent};

export interface AiBindings {
  env: AiEnv;
  factory: ProviderFactory;
  budgets: NeuronBudgetManager;
  decisions: D1DecisionRepository;
  scenarios: ScenarioService;
  recommendations: RecommendationService;
}

export default {
  async fetch(request: Request, env: AiEnv): Promise<Response> {
    const bindings = createBindings(env);
    const app = buildApp(bindings);
    return app.fetch(request, env);
  },
};

function createBindings(env: AiEnv): AiBindings {
  const factory = new ProviderFactory(env);
  const budgets = new NeuronBudgetManager(env.CACHE);
  const decisions = new D1DecisionRepository(env.DB);
  return {
    env,
    factory,
    budgets,
    decisions,
    scenarios: new ScenarioService(budgets, decisions, env.CACHE),
    recommendations: new RecommendationService(budgets, decisions, env.CACHE),
  };
}

function buildApp(b: AiBindings) {
  const app = new OpenAPIHono<{Bindings: AiEnv}>();

  // All AI routes are internal-only (called by the Gateway).
  app.use('*', internalOnlyMiddleware());
  app.onError(honoErrorHandler);

  // -- Route definitions ----------------------------------------------------

  const healthRoute = createRoute({
    method: 'get',
    path: '/healthz',
    responses: {
      200: {description: 'Service health.'},
    },
  });

  const providersRoute = createRoute({
    method: 'get',
    path: '/ai/providers',
    responses: {
      200: {description: 'Configured LLM providers.'},
    },
  });

  const scenarioRoute = createRoute({
    method: 'post',
    path: '/ai/scenario',
    request: {
      body: {
        content: {'application/json': {schema: scenarioRequestSchema}},
      },
    },
    responses: {
      200: jsonOk(scenarioResultSchema, 'Scenario simulation result.'),
      400: jsonError('Invalid request body.'),
    },
  });

  const recommendRoute = createRoute({
    method: 'post',
    path: '/ai/recommend',
    request: {
      body: {
        content: {'application/json': {schema: recommendationRequestSchema}},
      },
    },
    responses: {
      200: jsonOk(recommendationSchema, 'Recommendation result.'),
      400: jsonError('Invalid request body.'),
    },
  });

  const agentPlanRoute = createRoute({
    method: 'post',
    path: '/ai/agent/plan',
    request: {
      body: {
        content: {'application/json': {schema: agentPlanRequestSchema}},
      },
    },
    responses: {
      202: {description: 'Agent run started.'},
    },
  });

  const agentStateRoute = createRoute({
    method: 'get',
    path: '/ai/agent/{id}',
    responses: {
      200: jsonOk(agentStateSchema, 'Current agent state.'),
    },
  });

  const reflectAgentRoute = createRoute({
    method: 'post',
    path: '/ai/agent/{id}/reflect',
    responses: {
      200: {description: 'Reflection triggered.'},
    },
  });

  const historyRoute = createRoute({
    method: 'get',
    path: '/ai/history',
    request: {
      query: z.object({
        kind: z.string().optional(),
        page: z.string().optional(),
        size: z.string().optional(),
      }),
    },
    responses: {
      200: {description: 'Decision history page.'},
    },
  });

  // -- Route registration ---------------------------------------------------

  app.openapi(healthRoute, (c) =>
    jsonOkResponse(c, {service: 'ai', version: '0.1.0'}));

  app.openapi(providersRoute, async (c) => {
    const data = await providersHandler(b.factory);
    return jsonOkResponse(c, data);
  });

  app.openapi(scenarioRoute, async (c) => {
    const result = await scenarioHandler(
        c, c.req.valid('json'), b.scenarios, b.factory);
    return c.json(ok(result, c.req.header(HEADERS.TRACE_ID)), 200);
  });

  app.openapi(recommendRoute, async (c) => {
    const result = await recommendHandler(
        c, c.req.valid('json'), b.recommendations, b.factory);
    return c.json(ok(result, c.req.header(HEADERS.TRACE_ID)), 200);
  });

  app.openapi(agentPlanRoute, async (c) => {
    const data = await startAgentHandler(c, c.req.valid('json'), b.env);
    return c.json(ok(data, c.req.header(HEADERS.TRACE_ID)), 202);
  });

  app.openapi(agentStateRoute, async (c) => {
    const state = await agentStateHandler(c, b.env);
    return c.json(
        ok(state as z.infer<typeof agentStateSchema>,
            c.req.header(HEADERS.TRACE_ID)),
        200,
    );
  });

  app.openapi(reflectAgentRoute, async (c) => {
    const data = await reflectAgentHandler(c, b.env);
    return jsonOkResponse(c, data);
  });

  app.openapi(historyRoute, async (c) => {
    const data = await historyHandler(c, b.decisions);
    return jsonOkResponse(c, data);
  });

  // -- OpenAPI spec + Swagger UI -------------------------------------------

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'OntoDecide AI Service',
      version: '0.1.0',
      description:
        'Scenario simulation, recommendation and autonomous agent API.',
    },
  });

  app.get('/docs', (c) => c.html(scalarHtml()));

  app.notFound((c) =>
    jsonFailResponse(c, ERROR_CODES.NOT_FOUND, 'Route not found.'));

  return app;
}

/** Minimal Swagger UI page served from a CDN (no extra dependencies). */
function scalarHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI Service API Docs</title>
  <link rel="stylesheet"
        href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js">
  </script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({url: '/openapi.json', dom_id: '#swagger-ui'});
    };
  </script>
</body>
</html>`;
}
