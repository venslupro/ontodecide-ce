# OntoDecide CE — Architecture & Implementation Guide (V1.3)

This guide turns the three design documents (总体设计说明书 / 详细设计说明书 /
前端详细设计说明书, V1.3) into concrete repository conventions. When the
code and this guide disagree, fix one of them in the same change.

## 1. Deployment units

| Unit | Kind | Package | D1 | Notes |
| --- | --- | --- | --- | --- |
| `ontodecide-ce` | Pages | `apps/web` | — | SPA + `functions/api/[[path]].ts` proxy → `GATEWAY` |
| `api-gateway` | Worker | `apps/api-gateway` | — | Middleware chain, route table, BFF, EdgeGuard DO |
| `identity-access` | Worker | `apps/identity-access` + `packages/identity` | identity | Accounts, roles, markings, JWT |
| `ontology-manager` | Worker | `apps/ontology-manager` + `packages/ontology` | ontology | Schemas, publish, compile, packs |
| `data-integration` | Worker | `apps/data-integration` + `packages/integration` | integration | Sources, jobs, mapping, quality |
| `object-graph` | Worker | `apps/object-graph` + `packages/object-graph` | object | Objects, links, actions, lineage, Neo4j |
| `situation-awareness` | Worker | `apps/situation-awareness` + `packages/situation` | situation | KPIs, automations, alerts, DOs, DLQ |
| `decision-engine` | Worker | `apps/decision-engine` + `packages/decision` | decision | Simulation, recommendations, LLM |

Workers are listed by their `<service>` part: every deployed resource (Workers,
D1, KV, queues, B2, Neo4j, Vectorize) is named
`{project}-{env}-{service|module}`, e.g. `ontodecide-prd-api-gateway`,
`ontodecide-prd-graphdb`. Exceptions: the Pages project `ontodecide-ce` (its
URL is always https://ontodecide-ce.pages.dev) and the Terraform state bucket
`ontodecide-ce-tfstate`. Terraform builds names from `local.prefix`
(`var.project`, `var.environment`); templates use `${PREFIX}`, rendered by
`scripts/gen_wrangler.mjs`, which checks it against Terraform's `name_prefix`.

Every Worker has `workers_dev: false`. Service bindings form a DAG, so
deployment runs leaf → root:

```
ontology-manager → data-integration → object-graph → situation-awareness
  → decision-engine → identity-access → api-gateway → Pages (ontodecide-ce)
```

| Worker | Binds |
| --- | --- |
| data-integration | ONTOLOGY |
| object-graph | ONTOLOGY, INTEGRATION |
| situation-awareness | OBJECTS |
| decision-engine | OBJECTS, SITUATION, ONTOLOGY |
| api-gateway | all six |

There is one deployed environment, production, applied and deployed only from `main`.

Queues:

Queues are listed by logical name (deployed as `ontodecide-prd-<queue>`;
`baseQueueName` strips the prefix):

| Queue | Producer | Consumer | batch / retries |
| --- | --- | --- | --- |
| ingest | data-integration | data-integration | 4 / 3 |
| object-writes | data-integration | object-graph | 4 / 3 |
| graph-sync | object-graph | object-graph | 10 / 5 |
| situation-events | object-graph | situation-awareness | 10 / 3 |
| decision-jobs | situation-awareness, decision-engine | decision-engine | 5 / 3 |
| `*-dlq` (5) | runtime | situation-awareness (stored in `sit_dead_letter`, replayable) | 10 / 1 |

Deviations from the design text, and why:

* **data-integration does not bind DECISION.** `POST /sources/:id/mapping:suggest` is orchestrated by the
  gateway (ONTOLOGY model → DECISION.suggestMapping), as the frontend design specifies. This removes the
  object-graph → integration → decision → object-graph binding cycle.
* **decision-engine binds ONTOLOGY** to read action types for candidate generation.
* **Approval is a signed voucher** (`APPROVAL_SECRET`, HMAC). Decision signs, object-graph verifies, so there is no
  synchronous call back from object-graph to decision.
* **OntologyPublished** is orchestrated by the gateway after publish: `OBJECTS.onOntologyPublished`
  (reindex), plus `INTEGRATION.pauseSourcesForTypes` on breaking changes.
* **Dead letters** are consumed centrally by situation-awareness, which owns the "system health" page.
* **Approval executes the rank-1 action(s)** of a recommendation; lower-ranked actions are alternatives shown for
  comparison (the approve dialog lists only what will run).
* **Usage metering**: the gateway (requests) and decision-engine (AI neurons) call `SITUATION.recordUsage`.
  object-graph attaches D1 write counts to `situation-events` messages.

## 2. Repository layout (Google TypeScript style)

```
apps/<worker>/
  wrangler.jsonc.tpl     rendered to wrangler.jsonc by scripts/gen_wrangler.mjs (gitignored)
  src/env.ts             bindings (given)
  src/container.ts       composition root: createContainer(env, overrides?)
  src/service.ts         createService(env, overrides?): ServiceModule<XxxRpc>
  src/index.ts           WorkerEntrypoint class(es) + default export; the ONLY file importing cloudflare:workers
packages/<context>/
  contract/              RPC interfaces, DTOs, queue messages, zod input schemas (other packages import only this)
  domain/                aggregates, value objects, domain services — pure TS, no I/O, no Cloudflare types
  application/           use-case handlers (one class per use case) + port interfaces
  infrastructure/        D1 repositories, KV cache, queue publishers, B2 / Neo4j / LLM adapters
  interface/             RPC handler object implementing the contract; queue and cron dispatch
packages/shared-kernel/  CallCtx, Rid, DomainEvent, AppError/Problem, FilterExpr, JSONLogic, crypto, JWT, …
packages/testing/        Node fakes: D1 over node:sqlite, DO SqlStorage, KV, QueueBus (retries + DLQ), rpcBinding
migrations/<db>/         D1 migrations, one directory per database (file names are globally unique)
infra/                   Terraform (resources only)
scripts/                 gen_wrangler.mjs, bootstrap.sh, dev.sh, smoke.mjs
tests/e2e/               in-process full-loop test wiring all services through the gateway
samples/supply-chain/    demo CSVs for the built-in pack
```

Style rules (enforced by `gts` = ESLint + Prettier, `pnpm lint`):

* File names use `lower_snake_case.ts`. Tests sit next to the code as `foo_test.ts`.
* Named exports only. The one exception is the `export default` handler object that Workers require in `src/index.ts`.
* Each file starts with a `/** @fileoverview … */` comment. Exported symbols get JSDoc.
* Types and classes use `UpperCamelCase`, values use `lowerCamelCase`, constants use `CONSTANT_CASE`. No `I` prefix on interfaces.
* Dependencies point one way: `interface → application → domain`, `infrastructure → application/domain`.
  Cross-context imports go through `@ontodecide/<ctx>/contract` only (checked by dependency-cruiser).
* Throw `AppError(code, detail?)` from `@ontodecide/shared-kernel`. It survives RPC (see `AppError.from`).
* Every repository query filters by `ctx.tenantId`. A query with no tenant is a bug.
* Time comes from an injected `Clock` and ids from `ulid()` / `newRid()`, so logic stays testable.

## 3. Service module pattern

```ts
// apps/<worker>/src/service.ts
export interface Overrides { clock?: Clock; logger?: Logger; /* context-specific fakes */ }
export function createService(env: Env, overrides: Overrides = {}): ServiceModule<XxxRpc> {
  const c = createContainer(env, overrides);
  return {rpc: c.rpc, queue: b => c.queueHandler(b), scheduled: (cron, now) => c.cron(cron, now)};
}

// apps/<worker>/src/index.ts
import {WorkerEntrypoint} from 'cloudflare:workers';
let cache: {env: Env; svc: ServiceModule<XxxRpc>} | undefined;
const svc = (env: Env) => (cache?.env === env ? cache.svc : (cache = {env, svc: createService(env)}).svc);
export class XxxRpc extends WorkerEntrypoint<Env> {
  getThing(...a: Parameters<Contract['getThing']>) { return svc(this.env).rpc.getThing(...a); }
  // one explicit method per contract method (RPC requires prototype methods)
}
export default {
  fetch: () => new Response('Not found', {status: 404}),
  queue: (batch, env) => svc(env).queue!(batch),
  scheduled: (evt, env, ctx) => ctx.waitUntil(svc(env).scheduled!(evt.cron, new Date(evt.scheduledTime))),
} satisfies ExportedHandler<Env>;
```

`tests/e2e/harness.ts` builds every service with `createService(fakeEnv, overrides)`. Its fake env contains:
`createTestD1('<db>')`, a shared `QueueBus`, `MemoryKV`, `FakeDoNamespace`, and `rpcBinding(otherService.rpc)`
for service bindings. Everything except `src/index.ts` and Durable Object wrapper classes must therefore import
cleanly in Node.

Durable Objects keep their logic in a plain "core" class that takes a `SqlStorageLike` (and a broadcaster for
WebSockets). The `DurableObject` subclass lives next to `index.ts` and only delegates.

## 4. Public REST API (`/api/v1`, served by api-gateway)

Conventions:

* JSON bodies are the DTOs from the contracts, with no envelope.
* Errors are RFC 9457 `application/problem+json`, with `code` and `requestId`.
* Writes accept an `Idempotency-Key` header. Paging uses an opaque `cursor` and `limit` ≤ 200.
* Auth header is `Authorization: Bearer <access JWT>`. The refresh token lives in the HttpOnly cookie `od_refresh`
  (`Path=/api/v1/auth; SameSite=Strict; Secure`).
* Roles, lowest first: `Viewer < Operator < Modeler < Admin`.
* The gateway forwards `Accept-Language` as `ctx.locale`.

| Method & path | Min role | Target |
| --- | --- | --- |
| POST /auth/login | public | IDENTITY.login → `{accessToken, expiresIn, user}` + Set-Cookie |
| POST /auth/refresh | cookie | IDENTITY.refresh (rotates cookie) |
| POST /auth/logout | cookie | IDENTITY.logout, clears cookie → 204 |
| GET /me · PATCH /me · POST /me/password | Viewer | IDENTITY.me / updateMe / changePassword |
| GET /users · POST /users | Admin | listUsers / createUser |
| PATCH /users/:id · DELETE /users/:id | Admin | updateUser / deleteUser |
| POST /users/:id/markings | Admin | grantMarking(body.markings) |
| POST /users/:id/password:reset | Admin | resetPassword |
| GET /ontology/schemas | Viewer | listSchemas |
| GET /ontology/schemas/:api?version= | Viewer | getSchema |
| GET /ontology/model | Viewer | getActiveModel |
| PUT /ontology/schemas/:api/draft | Modeler | saveDraft |
| POST /ontology/schemas/:api/diff | Modeler | diff |
| POST /ontology/schemas/:api/publish | Modeler | BFF: publish → OBJECTS.onOntologyPublished → (breaking) INTEGRATION.pauseSourcesForTypes |
| GET /ontology/schemas/:api/export | Modeler | exportPack |
| GET /ontology/packs | Viewer | listPacks |
| POST /ontology/packs:import | Modeler | BFF: importPack → SITUATION.installPackContent |
| GET /sources · GET /sources/:id | Viewer | listSources / getSource |
| POST /sources · PATCH /sources/:id · DELETE /sources/:id | Modeler | create / update / delete |
| POST /sources/:id/uploads:presign | Operator | presignUpload |
| POST /sources/:id/batches | Operator | submitBatch → **202** (idempotent, rate group `ingest`) |
| POST /sources/:id/mapping:suggest | Modeler | BFF: ONTOLOGY.getActiveModel → DECISION.suggestMapping (rate group `ai`) |
| GET /jobs?sourceId= · GET /jobs/:id | Viewer | listJobs / getJob |
| GET /jobs/:id/rejected · POST /jobs/:id/replay | Operator | listRejected / replayRejected |
| GET /data-health | Viewer | dataHealth |
| POST /ingest/webhook/:sourceId | HMAC | INTEGRATION.acceptWebhook → **202** (60/min per source) |
| GET /objects/:type?filter=<json>&orderBy=<prop:dir>&cursor=&limit= | Viewer | listObjects |
| GET /objects/rid/:rid?expand=links&depth=1\|2 | Viewer | getObject (null → 404 OBJECT_NOT_FOUND) |
| GET /objects/rid/:rid/lineage · GET /objects/rid/:rid/actions | Viewer | lineage / listActionLog |
| GET /object-sets · POST /object-sets | Viewer / Operator | listObjectSets / saveObjectSet |
| POST /object-sets/:id/evaluate · POST /object-sets:evaluate | Viewer | evaluateSavedObjectSet / evaluateObjectSet |
| GET /search?q=&type= | Viewer | search |
| GET /graph/impact?rid=&maxHops=&limit= · GET /graph/paths?from=&to= | Viewer | impactSubgraph / paths |
| GET /merge-suggestions · POST /merge-suggestions/:id/resolve | Modeler | entity resolution |
| POST /actions/:actionType/apply (`If-Match`) | Operator | OBJECTS.applyAction (idempotent) |
| GET /situation/overview | Viewer | BFF: SITUATION.overview + INTEGRATION.dataHealth → `{...overview, dataHealth}` |
| GET /situation/stream (WebSocket, `?access_token=&lastSeq=`) | Viewer | SITUATION.fetch (ctx in `x-od-ctx`) |
| GET /kpis · POST /kpis · DELETE /kpis/:id · GET /kpis/:id/trend?range=24h\|7d | Viewer / Modeler | KPIs |
| GET /automations · POST /automations · PUT /automations/:id · DELETE /automations/:id | Viewer / Operator | automations |
| POST /automations:dry-run | Operator | dryRunAutomation |
| GET /alerts?status=&severity=&rid= · PATCH /alerts/:id | Viewer / Operator | listAlerts / updateAlert |
| GET /cockpit/layout · PUT /cockpit/layout | Viewer / Modeler | getLayout / saveLayout |
| GET /usage | Viewer | SITUATION.getUsage (quota bar) |
| GET /admin/usage · GET /admin/dlq?queue= · POST /admin/dlq/:queue/replay | Admin | UsageGuard / dead letters |
| POST /admin/graph:rebuild | Admin | OBJECTS.rebuildProjection |
| GET /scenarios · POST /scenarios · GET /scenarios/:id | Operator | scenarios |
| POST /scenarios/:id/run · POST /scenarios:run | Operator | runScenario |
| POST /scenarios:candidates | Operator | listCandidateActions |
| POST /recommendations:generate | Operator | generateRecommendation → **202** `{jobId}` (rate group `ai`) |
| GET /recommendations?status=&focus= · GET /recommendations/:id | Viewer | list / get |
| POST /recommendations/:id/approve · /reject · /feedback | Operator | approve (idempotent) / reject `{reason}` / feedback |
| GET /llm/quota | Viewer | DECISION.llmQuota |
| GET /config | public | KV feature flags `{features: {...}, version}` |
| POST /telemetry | public (≤ 16 KB) | written to Workers Logs → 204 |
| GET /openapi.json · GET /health | public | OpenAPI 3.1 generated from route table + zod |

Webhook signatures use `X-OD-Timestamp` (unix seconds) and `X-OD-Signature`, where the signature is
hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)) and the replay window is 300 s.

WebSocket frames:

* Server → client frames are `WsMsg {seq, type: snapshot|kpi|alert|recommendation|usage, data, occurredAt}`.
* Client → server frames are `{"type":"ping"}` every 30 s and `{"type":"resume","lastSeq":n}`.
* If the gap is ≤ 200 the server replays the missed frames; otherwise it sends a fresh `snapshot`.

## 5. The core loop (what `tests/e2e` exercises)

1. Admin logs in. The bootstrap admin is created on first login against an empty DB.
2. `POST /ontology/packs:import {packId:'supply-chain'}` publishes the schema and installs automations and KPIs.
3. Three sources are created: suppliers, materials, products (see `samples/supply-chain`). The browser parses the
   files and calls `POST /sources/:id/batches`. data-integration splits each batch into ≤ 50-record `ingest`
   messages. Its consumer maps, validates and entity-resolves, then emits `object-writes`. object-graph
   upserts (props_hash skip-write, outbox, stub objects for link targets that don't exist yet), calls
   `INTEGRATION.reportWriteResult`, and dispatches the outbox to `graph-sync` + `situation-events`.
4. situation-awareness consumes `situation-events` and recomputes KPIs via `OBJECTS.aggregate`. A supplier
   with `riskScore ≥ 70` opens a HIGH alert (unique while OPEN, then cooldown), which pushes to the
   SituationRoom and produces a `decision-jobs` message.
5. decision-engine consumes it and loads the impact subgraph (≤ 3 hops). It propagates the perturbation
   (γ = 0.9, prune below 0.5%), builds candidate actions (e.g. `switchSupplier` with `newSupplier` = the
   lowest-risk active supplier), and simulates `withActions`. It recalls similar cases, then ranks with the
   LLM chain (Workers AI → Gemini → Groq → rules), validating the output with zod plus an action whitelist.
   The result is saved as `Proposed` and pushed via `SITUATION.pushRecommendation`.
6. An Operator calls `POST /recommendations/:id/approve`. Decision signs a voucher and calls
   `OBJECTS.applyAction`, which checks role, voucher, If-Match and preconditions, applies the effects, writes the
   audit log and outbox, and attempts writeback (a failure sets `WRITEBACK_PENDING`, retried by cron).
   The status becomes `Executed`.
7. decision-engine's daily cron evaluates recommendations executed ≥ 24 h ago. It marks them `Evaluated`
   with `outcome` and stores the case for RAG. It also expires stale `Proposed` recommendations.

## 6. Commands

```
pnpm install
pnpm typecheck        # backend (tsc) + web
pnpm lint             # gts + dependency-cruiser
pnpm test             # vitest: backend (node) + web (jsdom)
pnpm gen:wrangler -- --env local   # render wrangler.jsonc for local dev
pnpm dev              # wrangler dev (all 7 workers, local D1/KV/DO/Queues) + vite
pnpm smoke            # HTTP smoke test of the full loop against pnpm dev
```
