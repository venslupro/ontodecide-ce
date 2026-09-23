# OntoDecide · Cloudflare Infrastructure (Terraform)

> **Shift-Left hybrid model**: Terraform owns **long-lived resources**
> (D1 / KV / Queues / Service Bindings / Cron / Domains).
> GitHub Actions + `wrangler deploy` owns **fast-moving code**
> (Worker bundles, runtime secrets, [vars] text env).

---

## 1 · Scope

### What Terraform CREATES and GOVERNS (this directory)

| Resource              | Count | Naming pattern                                          |
| --------------------- | ----: | ------------------------------------------------------- |
| D1 `shared-db`        | 1     | `${project}-${env_short}-shared-db` (ontodecide-prd-shared-db, user/ai/cleanup shared) |
| KV namespaces         | 11    | `${project}-${env_short}-${svc}-${binding-lowercase}` (ontodecide-prd-gateway-jwt-blacklist) |
| Cloudflare Queues     | 4     | `${project}-${env_short}-{ingestion,cleanup}{-dlq,}` (ontodecide-prd-ingestion, ontodecide-prd-cleanup-dlq) |
| Worker Script skeletons | 6   | `${project}-${env_short}-{service}` (ontodecide-prd-gateway, ontodecide-prd-graph) |
| Service Bindings      | 6     | Gateway → 5 downstreams, Ingestion → Graph (tier-ordered)|
| Cron Trigger          | 1     | Cleanup · 03:00 UTC daily                               |
| Workers Domain (opt.) | 1     | `api.${project}.com` (requires non-empty zone_id)       |
| B2 buckets (data)     | 2     | `${project}-${env_short}-{ingestion-staging,tenant-archive}` (allPrivate) |
| B2 Application Key    | 1     | Worker-scoped key (least-privilege) for ingestion + cleanup |
| Neo4j AuraDB instance | 1     | `${project}-${env_short}-neo4j` (free-db by default, v5) |

> **Env short**: `production` → `prd`, `staging` → `stg`

### What Terraform DOES NOT TOUCH (code layer)

- Worker script code / bundles → `wrangler-action` in
  `.github/workflows/deploy.yml`
- `[vars]` plain-text env → `wrangler.toml` + Dashboard Variables overrides
- `[ai]` Workers AI binding → `apps/api/ai/wrangler.toml` (bindings are
  unified in v5; AI binding type managed via wrangler.toml)
- Durable Object class uploads → `apps/api/ai/wrangler.toml`
  `[[migrations]] tag=v1`
- `[[queues.consumers]]` wiring including `dead_letter_queue` →
  per-service `wrangler.toml` (Terraform only creates the raw Queue resources)
- D1 migration SQL execution → `scripts/migrate.sh --remote` in the
  `migrate-d1` CI job that runs **after** all Workers deploy
- B2 tf-state bucket → created manually (chicken-and-egg: state
  backend must exist before `terraform init`)

---

## 2 · First-time setup

### 2.1 Install Terraform

```bash
# Any 1.9.x (versions.tf pin: ~> 1.9)
brew install terraform       # macOS
terraform version
```

### 2.2 Cloudflare credentials

1. Create a Cloudflare API token with the following scopes:
   - Account · D1 · Edit
   - Account · Workers KV Storage · Edit
   - Account · Queues · Edit
   - Account · Workers Scripts · Edit
   - Account · Account Settings · Read
   - Zone · Workers Routes · Edit (only if you use custom domains)
2. Export locally **OR** define via the GitHub Actions secrets/vars
   described in §3.

```bash
# Shell profile — NEVER commit real values.
export CLOUDFLARE_API_TOKEN='<your-wide-admin-token>'
export TF_VAR_account_id='<32-hex-char-account-id>'
export TF_VAR_zone_id='<32-hex-char-zone-id-or-empty>'   # optional
export TF_VAR_project_name='ontodecide'
export TF_VAR_environment='production'
```

### 2.2b Backblaze B2 — Terraform remote state bucket

Terraform state is persisted in a B2 bucket (S3-compatible backend) so
that CI runs share state. This prevents the "plan shows +create for all
resources but apply fails because they already exist" problem.

1. Create a **private** B2 bucket named `ontodecide-prd-tf-state` (region:
   `us-east-005`). Tag it with the same 4D governance tags as other B2
   buckets (Environment / Project / Service=tf-state / Lifecycle), enable
   **default encryption (SSE-B2)** and keep file versions (lifecycle
   "keep all versions") so a corrupted state can be rolled back.
   State contains plaintext secrets (B2 worker key, Neo4j password) —
   `encrypt = true` in `versions.tf` also requests SSE on every write.
2. Credentials (least privilege first):
   - **State backend** → `B2_STATE_KEY_ID` / `B2_STATE_KEY`: an application
     key restricted to the `ontodecide-prd-tf-state` bucket (list / read /
     write / delete files). Optional — falls back to the admin key below.
   - **B2 provider** → `B2_MASTER_KEY_ID` / `B2_MASTER_KEY`: needs to create
     buckets + application keys. Prefer a revocable non-master application
     key with `listBuckets, writeBuckets, listKeys, writeKeys` (+ file
     capabilities) over the real account master key.
   Workers use a separate, least-privilege **worker key** that Terraform
   auto-generates (see §3).
3. The backend config (bucket, endpoint, region, skip flags) is
   **static** in `versions.tf` — no `-backend-config` flags needed.
   To use a different bucket, create a local `backend_override.tf`
   (gitignored via `*_override.tf` pattern).
4. For **local dev**, just export B2 credentials:
   ```bash
   export AWS_ACCESS_KEY_ID='<B2_STATE_KEY_ID>'       # state-bucket key (or admin key)
   export AWS_SECRET_ACCESS_KEY='<B2_STATE_KEY>'
   export B2_APPLICATION_KEY_ID='<B2_MASTER_KEY_ID>'  # admin key (B2 provider)
   export B2_APPLICATION_KEY='<B2_MASTER_KEY>'
   terraform -chdir=infrastructure/terraform init -reconfigure
   ```
   (`-reconfigure` is needed once on existing checkouts after the backend
   gained `encrypt = true`.)
5. **Never** share `terraform show -json`, `terraform output -json`, a
   plan file, or `terraform.tfstate` — all contain plaintext secrets.

### 2.3 Init + validate (no Cloudflare calls, 100 % offline-safe)

```bash
terraform -chdir=infrastructure/terraform init -backend=false
terraform -chdir=infrastructure/terraform fmt -recursive
terraform -chdir=infrastructure/terraform validate
```

### 2.4 Plan against real Cloudflare state

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars   # then edit values
# Backend config is static in versions.tf — just export B2 creds and init:
export AWS_ACCESS_KEY_ID='<B2_STATE_KEY_ID>'
export AWS_SECRET_ACCESS_KEY='<B2_STATE_KEY>'
terraform init
terraform plan
```

### 2.5 Apply (ONE TIME, or when resources change)

```bash
# Option A — via GitHub Actions (RECOMMENDED):
#   push to main → terraform.yml runs fmt · validate · plan, then
#   PAUSES at the `production` Environment protection gate. A designated
#   reviewer approves and `terraform apply` runs against the reviewed
#   plan binary artifact.

# Option B — local (small/indie teams):
cd infrastructure/terraform
terraform apply   # NEVER in CI without the human gate defined in terraform.yml
```

### 2.6 After apply: wire KV IDs back into wrangler.toml

`wrangler deploy` *auto-creates* KV namespaces when `[[kv_namespaces]]`
omits `id`, which produces **duplicate** namespaces alongside the
Terraform-managed ones.  To prevent that, every wrangler.toml now ships
with `id = "REPLACE_WITH_TERRAFORM_CREATED_KV_*_ID"` placeholders.

Populate them ONCE after the first `terraform apply`:

```bash
cd infrastructure/terraform

# Method 1 — list titles from Terraform state, then cross-check in
#            Cloudflare Dashboard → Workers → KV
terraform output kv_namespaces

# Method 2 — get raw IDs using Cloudflare API / wrangler CLI:
#            (writes the correct KV id → binding map for you)
npx wrangler kv namespace list --json | jq '.[] | {title, id}'
```

Then paste each ID into the matching `[[kv_namespaces]]` block.

> **Note about CI Gate 4 (`wrangler types`):** The REPLACE_WITH_*
> placeholders are intentionally well-formed UUID-shaped strings so that
> `wrangler types` + `tsc --noEmit` pass in CI without real IDs.
> Real ID validation happens at Worker runtime (`validateWorkerConfig`)
> and on the *actual* `wrangler deploy` step, not during static gates.

---

## 3 · GitHub Actions secrets & variables (one-time repo config)

### 3.1 `terraform.yml` — Infrastructure pipeline

The Terraform pipeline uses the Cloudflare secrets shared with `deploy.yml`,
plus B2 master key and Neo4j Aura credentials for resource creation.

**Manually configured:**

| Kind     | Name                          | Description                                          |
| -------- | ----------------------------- | ---------------------------------------------------- |
| Secret   | `CF_API_TOKEN`                | Wide-scope Cloudflare API token (shared)             |
| Secret   | `CF_ACCOUNT_ID`               | 32-hex Cloudflare account ID (shared)               |
| Secret   | `B2_MASTER_KEY_ID` / `B2_MASTER_KEY` | B2 admin key — B2 provider (prefer a non-master key with bucket/key write caps) |
| Secret   | `B2_STATE_KEY_ID` / `B2_STATE_KEY` | (optional) state-bucket-only key for the S3 backend; falls back to the admin key |
| Secret   | `NEO4J_AURA_CLIENT_ID`        | Neo4j Aura API client ID (creates AuraDB instance)  |
| Secret   | `NEO4J_AURA_CLIENT_SECRET`    | Neo4j Aura API client secret                         |
| Variable | `TF_ZONE_ID`                  | (optional) Zone ID for `api.ontodecide.com`          |

**Uploaded as Cloudflare Worker Secrets by `deploy.yml` (never to GitHub):**

| Worker Secret      | Workers             | Source (Terraform state)                      |
| ------------------ | ------------------- | --------------------------------------------- |
| `B2_KEY_ID` / `B2_KEY` | ingestion + cleanup | Terraform `b2_application_key.worker` (bucket-scoped) |
| `NEO4J_PASSWORD`   | graph + cleanup     | Terraform `neo4jaura_instance.neo4j.password` |

Terraform owns the values; `deploy.yml` is their single writer. The
local composite action `.github/actions/tf-outputs` reads the outputs
straight from the remote state object (`aws s3 cp` + `jq`, no
`terraform init`), masks them, and each deploy job hands only the ones
it needs to `wrangler-action` `secrets:` — so secrets are uploaded
together with the code. `NEO4J_URI` / `NEO4J_USERNAME` are patched into
wrangler.toml `[vars]` the same way. No PAT and no GitHub Secrets hop.

- **Bootstrap is two steps:** `terraform.yml` apply → `deploy.yml`. No
  Worker has to exist before apply, and nothing has to be copied by hand.
- **Rotation:** `terraform apply -replace=b2_application_key.worker`
  (or reset the Neo4j password), then re-run `deploy.yml`.
- A deleted/recreated Worker simply gets its secrets back on the next
  `deploy.yml` run.
- Deploy jobs read state with `B2_STATE_READ_KEY_ID` / `B2_STATE_READ_KEY`
  (read-only key on the state bucket, recommended), falling back to
  `B2_STATE_KEY_*` then `B2_MASTER_KEY_*`.
- `b2_buckets` deliberately omits `account_id` (the B2 account ID is the
  master key's keyID, and outputs are printed in public CI logs).

The plan job uploads **only** `tfplan-summary.txt` (sensitive values
masked). Plan binaries and `terraform show -json` embed plaintext
secrets and must never be uploaded — artifacts of a public repository
are downloadable by anyone.

> **Project name** is fixed to `ontodecide` in `terraform.yml` env.
> **Environment** defaults to `production` (→ `prd`).

**Environment protection** (required — the whole point of Shift Left):
1. Repo → Settings → Environments → **New environment** → `production`
2. Enable **Required reviewers** → add 1–2 trusted humans
3. (Optional) Enable **Wait timer** → 5 min safety buffer

The `terraform.yml` → `apply` job references `environment: production`.
Without approval, the apply step **never runs** — Terraform changes stay
locked at the reviewed-plan stage.

### 3.2 `deploy.yml` — Code pipeline

| Kind     | Name                         | Scope of push                              |
| -------- | ---------------------------- | ------------------------------------------ |
| Secret   | `CF_API_TOKEN`               | All workers (wrangler deploy)              |
| Secret   | `CF_ACCOUNT_ID`              | All workers                                |
| Secret   | `JWT_SECRET`                 | gateway + user only                        |
| Secret   | `EMAIL_API_KEY`              | user only (optional)                       |
| Secret   | `B2_STATE_READ_KEY_ID` / `B2_STATE_READ_KEY` | (recommended) read-only state key — graph / ingestion / cleanup read Terraform outputs |
| Secret   | `GOOGLE_API_KEY` / `GROQ_API_KEY` | ai only (optional — set on Cloudflare Dashboard, not GitHub) |

> `NEO4J_PASSWORD`, `B2_KEY_ID` / `B2_KEY` and `NEO4J_URI` /
> `NEO4J_USERNAME` come from Terraform state at deploy time — never set
> them in GitHub. `NEO4J_DATABASE` stays a plain `[vars]` in wrangler.toml.

---

## 4 · Resource ordering & dependency map

```
                  ┌──────────────────────────┐
                  │  terraform apply (manual)│
                  └────────────┬─────────────┘
                               │ provisions
   ┌───────────┬───────────────┼────────────────┬───────────────┐
   ▼           ▼               ▼                ▼               ▼
┌───────┐ ┌─────────┐ ┌────────────────┐ ┌──────────┐ ┌──────────────┐
│ D1 +  │ │ KV +    │ │ Worker Scripts │ │ Queues / │ │ B2 buckets + │
│ KV +  │ │ Domains │ │ + Service Bonds│ │ Cron /   │ │ worker key + │
│Domains│ │         │ │                │ │ Domain   │ │ Neo4j AuraDB │
└───┬───┘ └────┬────┘ └───────┬────────┘ └────┬─────┘ └──────┬───────┘
    │          │              │               │              │
    ▼          ▼              ▼               ▼              ▼
(fill REPLACE_WITH_* IDs) sentinel code   (cron fires   remote state
  → wrangler.toml          replaced by:    daily 03:00Z)  → deploy.yml
                           wrangler deploy                 uploads Worker
                           ⟵ deploy.yml (auto)             Secrets w/ code
```

**Deploy order required by the hybrid model:**
1. `terraform apply` (human-reviewed, ONCE per infra change) — creates
   all resources including B2 buckets, worker key, Neo4j AuraDB
2. Fill in wrangler.toml `[[kv_namespaces]].id` placeholders (D1/KV
   IDs are resolved by `resolve-kv-ids.sh` / `resolve-d1-ids.sh` in CI)
3. Push code / run `deploy.yml` — reads B2 worker key + Neo4j creds from
   Terraform state, deploys all Workers with their secrets (3-layer
   dependency order)
4. Post-deploy `migrate-d1` job runs `scripts/migrate.sh --remote`
   against the shared D1

---

## 5 · Adding a 7th Worker (the `apps/web` anchor)

Three edits (no structural Terraform refactor needed):

```diff
  # infrastructure/terraform/main.tf
  locals {
    workers = {
+     web = { worker_name="decision-web-service", service="web", has_db=false, cron=[] }
      gateway = { … }
    }

    gateway_service_bindings = [
+     { binding = "WEB_SERVICE", target = "web" },
    ]

    kv_binding_map = [
+     { svc = "web", binding = "CACHE" },
    ]
  }
```

```diff
  # .github/workflows/deploy.yml
  env:
    DEFAULTS_MATRIX_JSON: >-
      [
+       {"name":"web","config":"apps/web/wrangler.toml","package":"@ontodecide/web","src_paths":["apps/web/**","packages/shared/**"]},
        {"name":"gateway", …}
      ]
```

Create `apps/web/wrangler.toml` following the pattern in
`apps/api/graph/wrangler.toml` (simplest example — no DB, no Queue,
single KV CACHE binding).

---

## 6 · Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `wrangler deploy` → *"binding XXX references nonexistent KV"* | Terraform hasn't provisioned the namespace yet, or IDs still have `REPLACE_WITH_*` placeholder | Run `terraform apply` once, then paste real KV IDs into wrangler.toml |
| `terraform plan` → *"cloudflare_workers_script has changed (external diff)"* | `wrangler deploy` overwrote the sentinel script, which is expected | Intentionally ignored via `lifecycle.ignore_changes = [content, main_module, compatibility_*, bindings]` — a fresh plan will show `0 to add, 0 to change, 0 to destroy` on scripts |
| Deploy fails → *"Queue 'ontodecide-prd-ingestion' not found"* | Legacy inline `wrangler queues create` shell was removed; Queue must exist from Terraform | Run `terraform apply` once to create the Queue resources (including DLQs) before deploy |
| `terraform apply` on first run → *"Service Binding target worker does not exist"* | Service Bindings require both Workers to exist first | Workers are split into **Tier 1** (user/ai/graph/cleanup) → **Tier 2** (ingestion) → **Tier 3** (gateway) with explicit `depends_on`. Terraform creates them in the correct order. If you still hit this, check that B2 remote state is configured (see §2). |
| `terraform validate` → *"An argument named 'tags' is not expected here"* | You added `tags =` to a resource that doesn't support tags | Only `cloudflare_workers_script` supports native `tags`. For D1/KV/Queue/Cron use the **name convention + comment + outputs summary** pattern used in main.tf instead. |

---

## 7 · File map

```
infrastructure/terraform/
├── versions.tf                # Terraform core + Cloudflare provider pins
├── providers.tf               # Provider config (env-based auth)
├── variables.tf               # All input variables + validation rules
├── main.tf                    # Resource declarations (D1 / KV / Queue / …)
├── outputs.tf                 # Post-apply review values + external deps
├── terraform.tfvars.example   # Copy → terraform.tfvars for local apply
├── .terraform.lock.hcl        # Provider hashes (DO commit this file)
└── README.md                  # This file
```
