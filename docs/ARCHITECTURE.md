# OntoDecide CE — Architecture & Implementation Guide (V2.4)

This guide turns the design documents (社区版设计修订说明书 V2.4.2, 总体设计 /
详细设计 / 前端详细设计说明书 V2.4) into repository conventions. When the design
documents disagree, the revision document (修订说明书) wins. When the code and
this guide disagree, fix one of them in the same change.

## 1. What the Community Edition is

* Anyone signs up with an e-mail code (no passwords) and gets **one trial
  workspace for 72 hours**; the user is its only **Owner**.
* One **bootstrap Admin** (system-unique, never expires, cannot be deleted or
  demoted, highest privilege) signs in with an e-mail code **plus a passkey**.
  It can see any data and act on any Owner; every admin action is audited in
  an append-only hash chain.
* When a trial ends (expiry, early termination or admin deletion) the data is
  exported to one ZIP in B2, a 7-day presigned download link is e-mailed, and
  the business data and account (including the e-mail) are deleted at once.
  The ZIP is deleted after 7 days.
* Everything runs on free tiers (Cloudflare Free, Backblaze B2, Resend with
  Brevo fallback, Workers AI). The only paid item is the domain.

## 2. Deployment units

| Unit | Kind | Package | Storage | Entry points |
| --- | --- | --- | --- | --- |
| `ontodecide-ce` | Pages (static) | `apps/web` | — | — |
| `api-gateway` | Worker | `apps/api-gateway` | — | default `fetch` |
| `identity-access` | Worker | `apps/identity-access` + `packages/identity` | D1 `identity-access-db`, B2 archive bucket | `IdentityRpc` |
| `ontology-manager` | Worker | `apps/ontology-manager` + `packages/ontology` | D1 `ontology-manager-db` | `OntologyRpc`, `TenantLifecycle` |
| `data-integration` | Worker | `apps/data-integration` + `packages/integration` | D1 `data-integration-db` | `IntegrationRpc`, `TenantLifecycle` |
| `object-graph` | Worker | `apps/object-graph` + `packages/object-graph` | D1 `object-graph-db` | `ObjectGraphRpc`, `TenantLifecycle` |
| `situation-awareness` | Worker | `apps/situation-awareness` + `packages/situation` | Durable Object `SituationRoom` (SQLite) | `SituationRpc` (+ `fetch` for WebSocket), `TenantLifecycle` |
| `decision-engine` | Worker | `apps/decision-engine` + `packages/decision` | D1 `decision-engine-db` | `DecisionRpc`, `TenantLifecycle` |

Naming: every deployed resource is `{project}-{env}-{service|module}`
(`${PREFIX}` in templates, e.g. `ontodecide-prd-api-gateway`,
`ontodecide-prd-object-graph-db`, `ontodecide-prd-domain-events`,
`ontodecide-prd-archive`). Exceptions: the Pages project `ontodecide-ce` and
the Terraform state bucket `ontodecide-ce-tfstate`. There is one deployed
environment (production, from `main`); `local` exists only for `wrangler dev`.

Resources (修订说明书 7.2): 7 Workers, 1 Pages project, 5 D1, 1 Durable Object
class, 2 Queues (`domain-events`, `dead-letter`), 2 Cron triggers, 0 KV,
0 Vectorize, 0 Neo4j, 1 Turnstile widget, 1 B2 bucket managed here (`archive`)
plus the hand-made tfstate bucket, 1 Zone (when a domain is configured).

Who creates what: **Terraform** creates resources (D1, Queues, B2 bucket and
keys, Turnstile, DNS / redirects / WAF rule on the zone). **Wrangler** creates
and deploys Workers and the Pages project and owns code, bindings, vars,
routes, crons and Durable Object migrations (`apps/*/wrangler.jsonc.tpl`,
rendered by `scripts/gen_wrangler.mjs` from `terraform output -json`).

### 2.1 Domain and routing

* `APP_DOMAIN` (GitHub variable, e.g. `example.com`; Terraform `var.domain`).
  The app is served at `https://app.${APP_DOMAIN}`: Pages custom domain for
  the SPA, and a Workers Route `app.${APP_DOMAIN}/api/*` on api-gateway (the
  only Worker with a route). Same origin: no CORS, `__Host-` cookie,
  CSP `connect-src 'self'`.
* Fallback (修订说明书 4.2, used while `APP_DOMAIN` is empty): the Pages
  Function `apps/web/functions/api/[[path]].ts` forwards `/api/*` to the
  gateway through a service binding and the app lives at
  `https://ontodecide-ce.pages.dev`. With a domain configured the deploy job
  publishes the SPA without `functions/` (pure static).
* Every Worker has `workers_dev: false` and `preview_urls: false`.

### 2.2 Service bindings (DAG, no cycles)

| Worker | Binds (binding → service / entrypoint) |
| --- | --- |
| ontology-manager | — |
| object-graph | `ONTOLOGY` → ontology-manager / OntologyRpc |
| situation-awareness | `OBJECTS` → object-graph / ObjectGraphRpc, `ONTOLOGY` → ontology-manager / OntologyRpc |
| decision-engine | `OBJECTS`, `SITUATION` → situation-awareness / SituationRpc, `ONTOLOGY` |
| data-integration | `ONTOLOGY`, `OBJECTS` |
| identity-access | `LC_ONTOLOGY`, `LC_INTEGRATION`, `LC_OBJECTS`, `LC_SITUATION`, `LC_DECISION` → each service / **TenantLifecycle** (no business RPC) |
| api-gateway | `IDENTITY`, `ONTOLOGY`, `INTEGRATION`, `OBJECTS`, `SITUATION`, `DECISION` → business entry points (never TenantLifecycle) |

Deploy order: ontology-manager → object-graph → situation-awareness →
decision-engine; data-integration after object-graph; identity-access after
the five; api-gateway after all six; Pages last.

### 2.3 Worker environment (binding names are part of the contract)

| Worker | Bindings | Vars | Secrets |
| --- | --- | --- | --- |
| ontology-manager | `ONTOLOGY_DB` (D1) | `ENVIRONMENT`, `APP_VERSION` | — |
| object-graph | `OBJECT_DB`, `ONTOLOGY`, `DOMAIN_EVENTS` (queue producer) | `MAX_OBJECTS`=300, `MAX_LINKS`=900 | — |
| situation-awareness | `SITUATION_ROOM` (DO), `OBJECTS`, `ONTOLOGY`; consumer of `domain-events` | `APP_ORIGIN` | — |
| decision-engine | `DECISION_DB`, `OBJECTS`, `SITUATION`, `ONTOLOGY`, `AI` | `AI_MODEL`, `AI_FALLBACK_MODEL`, `REC_AI_USER_DAILY_LIMIT`=3, `NEURONS_DAILY_BUDGET`=6500, `NEURONS_RESERVE_FACTOR`=1.3, `REC_EXPIRE_HOURS`=24 | — |
| data-integration | `INTEGRATION_DB`, `ONTOLOGY`, `OBJECTS`, `AI` | `AI_MODEL`, `NEURONS_DAILY_BUDGET`=1500, `IMPORT_ROWS_DAILY`=2000, `SEED_ROWS_DAILY`=20000, `MAPPING_AI_DAILY`=2 | — |
| identity-access | `IDENTITY_DB`, `LC_*` | `APP_ORIGIN`, `MAIL_FROM`, `EMAIL_MODE` (`live`\|`log`), `TRIAL_HOURS`=72, `ARCHIVE_DAYS`=7, `ARCHIVE_DELAY_MIN`=16, `PURGE_BACKLOG_LIMIT`=10, `PURGE_ROWS_DAILY`=30000, `MAX_SESSIONS`=3, `ADMIN_SESSION_HOURS`=8, `RESEND_DAILY_CAP`=90, `RESEND_MONTHLY_CAP`=2900, `BREVO_DAILY_CAP`=280, `B2_ARCHIVE_BUCKET`, `B2_ENDPOINT`, `B2_REGION`, `ARCHIVE_LINK_TTL_S`=604800, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `CF_ACCOUNT_ID`, `ENVIRONMENT`, `APP_VERSION` | `JWT_SIGNING_KEY` (Ed25519 private JWK with kid), `EMAIL_PEPPER`, `EMAIL_ENC_KEY`, `RESEND_API_KEY`, `BREVO_API_KEY`, `TURNSTILE_SECRET`, `B2_WRITE_KEY_ID`, `B2_WRITE_APP_KEY`, `B2_SIGN_KEY_ID`, `B2_SIGN_APP_KEY`, `CF_ANALYTICS_TOKEN` (optional), `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_SETUP_CODE` |
| api-gateway | the six services, `RL_USER_READ` (120/60 s), `RL_USER_WRITE` (30/60 s), `RL_EMAIL` (5/60 s), `RL_IP_AUTH` (10/60 s) | `APP_ORIGIN`, `JWT_PUBLIC_KEYS` (JWK set, rendered from the signing key(s)), `MAX_BODY_BYTES`=524288, `ACT_AS_CACHE_S`=60, `ENVIRONMENT`, `APP_VERSION` | — |

Crons (2 in total): identity-access `*/2 * * * *` (reminders, expiry, one
archive step for one workspace, one final delete, housekeeping; hourly
analytics check), object-graph `*/15 * * * *` (outbox redelivery).
Scheduled automations use the SituationRoom DO alarm, not cron.

Queues: `domain-events` — producer object-graph (outbox, one aggregated
message ≤ 64 KB per commit), consumer situation-awareness (batch 10,
3 retries, dead letter `dead-letter`); `dead-letter` has no consumer.

Durable Object migrations: `situation-awareness` keeps tag `v1`
(`SituationRoom`, `UsageGuard`) and adds `v2` deleting `UsageGuard`;
`api-gateway` keeps `v1` (`EdgeGuard`) and adds `v2` deleting `EdgeGuard`
(V1.3 deployments had those classes). SituationRoom drops its V1.3 tables on
first start (schema version key).

## 3. Repository layout (Google TypeScript style)

```
apps/<worker>/
  wrangler.jsonc.tpl     rendered to wrangler.jsonc by scripts/gen_wrangler.mjs (gitignored)
  src/env.ts             bindings (section 2.3)
  src/container.ts       composition root: createContainer(env, overrides?)
  src/service.ts         createService(env, overrides?): ServiceModule<XxxRpc>
  src/index.ts           WorkerEntrypoint classes + default export; the ONLY file importing cloudflare:workers
packages/<context>/
  contract/              RPC interfaces, DTOs, zod input schemas (other packages import only this)
  domain/                aggregates, value objects, domain services — pure TS, no I/O
  application/           use-case handlers (one class/function per use case) + port interfaces
  infrastructure/        D1 repositories (extend TenantRepository), queue, Workers AI, B2, e-mail adapters
  interface/             RPC handler object implementing the contract; TenantLifecycle; queue / cron dispatch
packages/shared-kernel/  CallCtx, Rid, errors (RFC 9457), Ed25519 JWT, filters, paging, limits, lifecycle types
packages/shared-kernel/d1  server-only: TenantRepository / SystemRepository, capped counters, tombstones
packages/testing/        Node fakes: D1 over node:sqlite, DO SqlStorage, QueueBus, rpcBinding, FakeWorkersAi, FakeRateLimiter
migrations/<service>/    D1 migrations per database: identity-access, ontology-manager, data-integration, object-graph, decision-engine
apps/api-gateway/openapi.yaml   OpenAPI 3.2.0 — the only public API contract
infra/                   Terraform (resources only)
scripts/                 gen_wrangler.mjs, gen_secrets.mjs, dev.sh, smoke.mjs, check_sql.mjs, …
tests/e2e/               in-process full-loop tests wiring every service through the gateway
```

Style rules (`gts` = ESLint + Prettier; `pnpm lint`):

* File names `lower_snake_case.ts`; tests next to code as `foo_test.ts`.
* Named exports only (except the `export default` handler in `src/index.ts`).
* Every file starts with `/** @fileoverview … */`; exported symbols get JSDoc.
* `UpperCamelCase` types/classes, `lowerCamelCase` values, `CONSTANT_CASE`
  constants, no `I` prefix.
* Dependencies point inward: `interface → application → domain`,
  `infrastructure → application/domain`. Cross-context imports only through
  `@ontodecide/<ctx>/contract` (dependency-cruiser).
* Throw `AppError(code, detail?, {status?, extras?})`; it survives RPC.
* Repositories extend `TenantRepository` and use `stmt()` (binds `?1` =
  `ctx.tid`); only `SystemRepository` (cron, queue, lifecycle) may run
  unscoped SQL. `scripts/check_sql.mjs` (part of `pnpm lint`) rejects
  `.prepare(` in `packages/*/infrastructure` outside those bases.
* Time from an injected `Clock`, ids from `ulid()` / `newRid()`.
* No personal data in logs, metrics or queue messages (only tid / sub ULIDs).

## 4. Service module pattern

```ts
// apps/<worker>/src/service.ts
export interface Overrides { clock?: Clock; logger?: Logger; /* fakes */ }
export function createService(env: Env, overrides: Overrides = {}): ServiceModule<XxxRpc> {
  const c = createContainer(env, overrides);
  return {rpc: c.rpc, lifecycle: c.lifecycle, queue: b => c.queue(b), scheduled: (cron, now) => c.cron(cron, now)};
}

// apps/<worker>/src/index.ts
import {WorkerEntrypoint} from 'cloudflare:workers';
export class XxxRpc extends WorkerEntrypoint<Env> {
  getThing(...a: Parameters<Contract['getThing']>) { return svc(this.env).rpc.getThing(...a); }
}
export class TenantLifecycle extends WorkerEntrypoint<Env> {
  exportTenant(tid: string, cursor: string | null) { return svc(this.env).lifecycle!.exportTenant(tid, cursor); }
  purgeTenant(tid: string, maxRows: number) { return svc(this.env).lifecycle!.purgeTenant(tid, maxRows); }
  countTenant(tid: string) { return svc(this.env).lifecycle!.countTenant(tid); }
}
export default {fetch: () => new Response('Not found', {status: 404}), /* queue, scheduled */} satisfies ExportedHandler<Env>;
```

`tests/e2e/harness.ts` builds every service with `createService(fakeEnv,
overrides)` and wires bindings with `rpcBinding(svc.rpc)` /
`rpcBinding(svc.lifecycle)`. Everything except `src/index.ts` and Durable
Object wrapper classes must import cleanly in Node. Durable Objects keep
their logic in a plain core class taking `SqlStorageLike`; the
`DurableObject` subclass only delegates.

## 5. Public REST API (`/api/v1`, api-gateway)

Conventions (修订说明书 10.1): OpenAPI 3.2.0 in `apps/api-gateway/openapi.yaml`
(operationIds match `routes.ts`; a test checks both directions). JSON bodies
are the contract DTOs without envelopes. Errors are RFC 9457
`application/problem+json` with `code` and `traceId`. Paging `?cursor=&limit=`
(≤ 100) → `nextCursor`. Modifiable resources return `ETag: "v{n}"`;
PUT / PATCH / DELETE require `If-Match` (412 on mismatch). Action executions,
recommendation decisions and every `/admin/*` write require
`Idempotency-Key` (16–64 chars). High-risk admin writes require
`X-Step-Up` (token from a passkey user verification, ≤ 5 min).
`Accept-Language` only affects e-mails and server-generated text.

Scopes: `public`; `refresh` (cookie `__Host-od_rt` + Origin); `workspace`
(owner token for its own workspace, or admin token for the admin workspace /
the `X-Act-As-Tenant` target); `admin` (role admin with `amr` ⊇ passkey; no
Act-as). Rate classes: `read`/`write` (RL_USER_* by sub), `email` (RL_EMAIL by
e-mail), `ip` (RL_IP_AUTH by IP).

Gateway chain (详细设计 6.11.7): requestId → security headers → body ≤ 512 KB
(413 VALIDATION_FAILED) → route match (404) → Origin check for writes and
refresh (403) → Ed25519 verify (401 UNAUTHENTICATED; owner with `texp ≤ now`
or `st ≠ ACTIVE` → 401 TRIAL_EXPIRED) → admin tokens: `IDENTITY.
verifyAdminSession(sid)` on every request → role / scope → `X-Act-As-Tenant`
(admin only, target must exist and be `kind = trial`, writes need ACTIVE;
status cached ≤ 60 s; owner → 403) → rate limit → zod input validation →
required headers → Act-as writes: `IDENTITY.audit(tenant.write)` first
(failure → 503) → RPC → Problem Details.

| Method & path | Scope · rate | Target |
| --- | --- | --- |
| POST /auth/codes | public · email+ip | IDENTITY.sendCode → 202 |
| POST /auth/sessions | public · ip | IDENTITY.createSession → 201 `{accessToken, expiresIn, me}` + cookie, or 200 `{passkeyRequired: true, preAuth, setupRequired}` |
| POST /auth/sessions/refresh | refresh · ip | IDENTITY.refresh → 200 `{accessToken, expiresIn}` + rotated cookie |
| DELETE /auth/sessions/current | workspace · write | IDENTITY.logout → 204, cookie cleared |
| POST /auth/passkeys/options | public (login, preAuth) / admin (step_up) · ip | IDENTITY.passkeyOptions |
| POST /auth/passkeys/assertion | same · ip | IDENTITY.passkeyAssertion → 201 session + cookie (login) or 200 `{stepUpToken, expiresIn}` |
| POST /auth/passkeys/setup-options | public · ip | IDENTITY.passkeySetupOptions (first passkey; preAuth + setup code) |
| POST /auth/passkeys/setup | public · ip | IDENTITY.passkeySetup → 201 `{passkey, total, accessToken, expiresIn, me}` + cookie |
| POST /auth/recovery | public · ip | IDENTITY.recoveryLogin → 201 session + cookie |
| GET /me | workspace · read | BFF: IDENTITY.getMe + usage of IDENTITY, INTEGRATION, DECISION + OBJECTS.stats → `MeDto & {quotas}` |
| PATCH /me | workspace · write | IDENTITY.patchMe |
| POST /me/codes | workspace · write | IDENTITY.sendMeCode → 202 |
| POST /me/trial/termination | workspace · write | IDENTITY.terminateTrial → 202 |
| GET /me/export | workspace · read | IDENTITY.exportChunk loop → `application/jsonl` stream |
| POST /workspace/sample-data | workspace · write | INTEGRATION.loadSample → 202 JobDto |
| GET /archive-deletions/{token} | public · ip | IDENTITY.getArchiveDeletion |
| POST /archive-deletions/{token} | public · ip | IDENTITY.deleteArchiveByToken → 204 |
| GET /ontology | workspace · read | ONTOLOGY.getOntology (ETag) |
| GET /{kind} · POST /{kind} | workspace · read / write | ONTOLOGY.listDefinitions / putDefinition (If-Match = schema ETag; id = body.apiName) — `kind` ∈ object-types, link-types, action-types |
| GET /{kind}/{id} · PUT /{kind}/{id} · DELETE /{kind}/{id} | workspace · read / write | ONTOLOGY.getDefinition / putDefinition / deleteDefinition (If-Match) |
| GET /imports · POST /imports | workspace · read / write | INTEGRATION.listImports / createImport → 201 |
| GET /imports/{id} | workspace · read | INTEGRATION.getImport |
| PUT /imports/{id}/mapping | workspace · write | INTEGRATION.putMapping |
| POST /imports/{id}/batches | workspace · write | INTEGRATION.submitBatch → 200 |
| POST /imports/{id}/mapping-draft | workspace · write | INTEGRATION.mappingDraft |
| GET /objects?type=&q=&filter=&orderBy=prop:dir&cursor=&limit= | workspace · read | OBJECTS.listObjects |
| GET /objects/stats | workspace · read | OBJECTS.stats |
| GET /objects/{rid} | workspace · read | OBJECTS.getObject (ETag; null → 404) |
| PATCH /objects/{rid} | workspace · write · If-Match | OBJECTS.patchObject (`application/merge-patch+json`) |
| GET /objects/{rid}/links?depth=&linkTypes=&direction=&limit= | workspace · read | OBJECTS.getLinks |
| GET /objects/{rid}/actions | workspace · read | OBJECTS.listActionLog |
| POST /action-types/{id}/executions | workspace · write · Idempotency-Key, If-Match | OBJECTS.applyAction |
| GET /situation/overview?range=24h\|7d | workspace · read | BFF: SITUATION.overview + DECISION.listRecommendations(Proposed, 5) + quotas |
| GET /alerts · POST /alerts/{id}/acknowledgement | workspace · read / write | SITUATION.listAlerts / acknowledgeAlert |
| GET /automations · POST /automations | workspace · read / write | SITUATION.listAutomations / createAutomation → 201 |
| GET · PUT · DELETE /automations/{id} | workspace · read / write (If-Match) | SITUATION.getAutomation / putAutomation / deleteAutomation |
| POST /situation/stream-tickets | workspace · write | SITUATION.issueStreamTicket → 201 |
| GET /situation/stream?ticket= | Origin check | WebSocket → `SITUATION.fetch(request)` (ticket = `{tid}.{random}`) |
| POST /scenarios · GET /scenarios/{id} | workspace · write / read | DECISION.runScenario → 201 / getScenario |
| GET /recommendations?status= · GET /recommendations/{id} | workspace · read | DECISION.listRecommendations / getRecommendation |
| POST /recommendations | workspace · write | DECISION.generateRecommendation → 201 |
| POST /recommendations/{id}/decision | workspace · write · Idempotency-Key | DECISION.decide |
| GET /admin/overview | admin · read | IDENTITY.adminOverview |
| GET /admin/users · GET /admin/users/{uid} | admin · read | adminListUsers / adminGetUser |
| PATCH /admin/users/{uid} | admin · write · Idempotency-Key, X-Step-Up | adminPatchUser |
| DELETE /admin/users/{uid}/sessions | admin · write · Idempotency-Key | adminRevokeSessions |
| DELETE /admin/users/{uid}?archive=true\|false | admin · write · Idempotency-Key, X-Step-Up | adminDeleteUser `{reason}` → 202 |
| GET /admin/archives | admin · read | adminListArchives |
| POST /admin/archives/{tid}/download-link | admin · write · Idempotency-Key | adminArchiveLink (15 min) |
| DELETE /admin/archives/{tid} | admin · write · Idempotency-Key, X-Step-Up | adminDeleteArchive → 204 |
| GET /admin/settings · PATCH /admin/settings | admin · read / write (If-Match, Idempotency-Key, X-Step-Up) | adminGetSettings / adminPatchSettings |
| GET /admin/blocked-domains · PUT /admin/blocked-domains | admin · read / write (Idempotency-Key) | adminGetBlockedDomains / adminPutBlockedDomains |
| GET /admin/audit-log | admin · read | adminAuditLog (`chainOk`) |
| GET /admin/passkeys · POST /admin/passkeys/options | admin · read / write | adminListPasskeys / adminPasskeyOptions |
| POST /admin/passkeys · DELETE /admin/passkeys/{id} | admin · write · X-Step-Up | adminAddPasskey → 201 / adminDeletePasskey → 204 |
| GET /health · GET /openapi.yaml | public | liveness · the contract |

Additions to the design's list (all within its conventions): `GET /ontology`,
`PUT /imports/{id}/mapping`, `GET /objects/stats`, `GET /objects/{rid}/actions`,
`GET /recommendations/{id}`, `GET /imports`, `/auth/passkeys/setup-options`,
`/auth/passkeys/setup` (first passkey before a session exists) and the
`X-Step-Up` header carrying the passkey user-verification proof.

WebSocket frames: server → client `WsMsg {seq, type: snapshot|kpi|alert|
recommendation|trial, data, occurredAt}`; heartbeats are protocol ping/pong
auto-responses (no app heartbeat). Client may send `{"type":"resume",
"lastSeq":n}`: gap ≤ 200 is replayed, otherwise a fresh snapshot. A trial end
closes sockets with code 4401.

## 6. Core flows (what `tests/e2e` exercises)

1. **Sign-up**: `POST /auth/codes` (Turnstile, admission pre-check) → code
   e-mail → `POST /auth/sessions` creates user + trial workspace in one D1
   batch (atomic signup quota), issues tokens.
2. **Sample data**: `POST /workspace/sample-data` → data-integration writes
   80 objects / 160 links through `OBJECTS.upsertBatch` (one statement per
   table + one outbox row) → `domain-events` → SituationRoom updates KPIs,
   raises alerts (≤ 1 OPEN per automation × rid), pushes over WebSocket.
3. **File import**: `POST /imports` → mapping (deterministic + AI draft) →
   `POST /imports/{id}/batches` × n (≤ 100 rows, sync, idempotent by seq).
4. **Decision**: `POST /scenarios` (deterministic propagation, γ = 0.9,
   depth ≤ 2) → `POST /recommendations` (deterministic candidates with fixed
   params; qwen3 ranks ids + rationale, gpt-oss-20b fallback, rules when the
   quota is used up) → `POST /recommendations/{id}/decision` → executes
   ranking[0] via `OBJECTS.applyAction` as `svc:decision-engine`.
5. **Admin**: code + passkey login (setup code for the first passkey, then a
   second passkey and 10 recovery codes); Act-as-Tenant with audit.
6. **Trial end** (修订说明书 9): EXPIRED → wait 16 min → one cron step per
   call: export pages to B2 staging → ZIP (STORE) → presigned 7-day link →
   archive e-mail → purge each service (≤ 500 rows/step, local tombstone) →
   delete account → after 7 days (or "delete now") delete the ZIP.

## 7. Commands

```
pnpm install
pnpm typecheck        # backend (tsc) + web
pnpm lint             # gts + dependency-cruiser + check_sql
pnpm test             # vitest: backend (node) + web (jsdom)
pnpm gen:wrangler -- --env local   # render wrangler.jsonc for local dev
pnpm dev              # wrangler dev (7 workers; local D1/DO/Queues) + vite
pnpm smoke            # HTTP smoke test against pnpm dev (or SMOKE_BASE_URL)
node scripts/gen_secrets.mjs       # generate JWT / pepper / setup-code secrets
```
