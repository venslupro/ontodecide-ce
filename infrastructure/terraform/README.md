# OntoDecide · Cloudflare Infrastructure (Terraform)

> **Shift-Left hybrid model**: Terraform owns **long-lived resources**
> (D1 / KV / Queues / Service Bindings / Cron / Domains).
> GitHub Actions + `wrangler deploy` owns **fast-moving code**
> (Worker bundles, runtime secrets, [vars] text env).

---

## 1 · Scope

### What Terraform CREATES and GOVERNS (this directory)

| Resource              | Count | Naming pattern                                     |
| --------------------- | ----: | -------------------------------------------------- |
| D1 `decision-db`      | 1     | `${project}-decision-db-${env}`                    |
| KV namespaces         | 11    | `${project}-${BINDING_NAME}-${env}`                |
| Cloudflare Queues     | 4     | `${project}-{ingestion,cleanup}{-dlq,}-${env}`     |
| Worker Script skeletons | 6   | `decision-{gateway,user-service,…}`                |
| Service Bindings      | 6     | Gateway → 5 downstreams, Ingestion → Graph         |
| Cron Trigger          | 1     | Cleanup · 03:00 UTC daily                          |
| Workers Domain (opt.) | 1     | `api.${project}.com` (requires non-empty zone_id)  |

### What Terraform DOES NOT TOUCH (code layer)

- Worker script code / bundles → `wrangler-action` in
  `.github/workflows/deploy-workers.yml`
- `[vars]` plain-text env → `wrangler.toml` + Dashboard Variables overrides
- `[ai]` Workers AI binding → `apps/api/ai/wrangler.toml` (Provider v4 lacks
  `ai_binding` block on `cloudflare_workers_script`)
- Durable Object class uploads → `apps/api/ai/wrangler.toml`
  `[[migrations]] tag=v1`
- `[[queues.consumers]]` wiring including `dead_letter_queue` →
  per-service `wrangler.toml` (Terraform only creates the raw Queue resources)
- D1 migration SQL execution → `scripts/migrate.sh --remote` in the
  `migrate-d1` CI job that runs **after** all Workers deploy
- Backblaze B2 buckets / Neo4j AuraDB instance → external IaC or console
  (expected tags & schemas summarized in `outputs.tf` external_* blocks)

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
terraform init     # now with real provider auth
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

The Terraform pipeline **reuses** the same secrets already configured for
`deploy-workers.yml` — no extra secrets or variables to create.

| Kind      | Name                         | Description                                |
| --------- | ---------------------------- | ------------------------------------------ |
| **Secret**| `CF_API_TOKEN`               | Wide-scope Cloudflare API token (shared)   |
| **Secret**| `CF_ACCOUNT_ID`              | 32-hex Cloudflare account ID (shared)     |
| Variable  | `TF_ZONE_ID`                 | (optional) Zone ID for `api.ontodecide.com`|

> **Project name** is derived automatically from the GitHub repo name
> (`github.event.repository.name`). **Environment** defaults to
> `production` and can be overridden via `workflow_dispatch` input.

**Environment protection** (required — the whole point of Shift Left):
1. Repo → Settings → Environments → **New environment** → `production`
2. Enable **Required reviewers** → add 1–2 trusted humans
3. (Optional) Enable **Wait timer** → 5 min safety buffer

The `terraform.yml` → `apply` job references `environment: production`.
Without approval, the apply step **never runs** — Terraform changes stay
locked at the reviewed-plan stage.

### 3.2 `deploy-workers.yml` — Code pipeline (unchanged from legacy model, listed for completeness)

| Kind      | Name                         | Scope of push                              |
| --------- | ---------------------------- | ------------------------------------------ |
| Secret    | `CF_API_TOKEN`               | All workers (wrangler deploy)              |
| Secret    | `CF_ACCOUNT_ID`              | All workers                                |
| Secret    | `JWT_SECRET`                 | gateway + user only                        |
| Secret    | `EMAIL_API_KEY`              | user only                                  |
| Secret    | `NEO4J_PASSWORD`             | graph + cleanup                            |
| Secret    | `B2_KEY_ID` / `B2_KEY`       | ingestion + cleanup                        |
| Secret    | `OPENAI_API_KEY` / …         | ai only (all optional)                     |

> The `migrate-d1` job derives project name from the GitHub repo name
> and environment from the deploy input (defaults to `production`).

---

## 4 · Resource ordering & dependency map

```
                  ┌──────────────────────────┐
                  │  terraform apply (manual)│
                  └────────────┬─────────────┘
                               │ provisions
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
  │ D1 + KV +   │    │ Worker Scripts   │    │ Queues / Cron / │
  │ Domains     │    │ + Service Bonds  │    │ Workers Domain  │
  └──────┬──────┘    └───────┬──────────┘    └──────┬──────────┘
         │                  │                      │
         ▼                  ▼                      ▼
  (dashboard overrides)  sentinel code      (cron fires daily 03:00Z)
  fill REPLACE_WITH_*    replaced by:
  IDs → wrangler.toml      wrangler deploy ⟵ deploy-workers.yml (auto)
```

**Deploy order required by the hybrid model:**
1. `terraform apply` (human-reviewed, ONCE per infra change)
2. Fill in wrangler.toml `[[kv_namespaces]].id` placeholders + any
   `[vars]` Dashboard overrides (Neo4j URL, B2 bucket names)
3. Push code → `deploy-workers.yml` runs (change-aware · parallel
   matrix · 5 quality gates incl. `wrangler types`)
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
  # .github/workflows/deploy-workers.yml
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
| `terraform plan` → *"cloudflare_workers_script has changed (external diff)"* | `wrangler deploy` overwrote the sentinel script, which is expected | Intentionally ignored via `lifecycle.ignore_changes = [content, module, compatibility_*, *_binding]` — a fresh plan will show `0 to add, 0 to change, 0 to destroy` on scripts |
| Deploy fails → *"Queue 'ontodecide-ingestion-production' not found"* | Legacy inline `wrangler queues create` shell was removed; Queue must exist from Terraform | Run `terraform apply` once to create the Queue resources (including DLQs) before deploy |
| `terraform apply` on first run → *"Service Binding target worker does not exist"* | Service Bindings require both Workers to exist first | The sentinel script in `cloudflare_workers_script.svc` uses `create_before_destroy = true` + one `for_each` across all 6 workers; Terraform resolves the creation order automatically. If you still hit this, apply twice (harmless second pass). |
| `terraform validate` → *"An argument named 'tags' is not expected here"* | You added `tags =` to a resource that doesn't support tags on Provider v4 | Only `cloudflare_workers_script` supports native `tags` on v4.52. For D1/KV/Queue/Cron use the **name convention + comment + outputs summary** pattern used in main.tf instead. |

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
