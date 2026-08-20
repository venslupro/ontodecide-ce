# ============================================================
# Workers Builds (Git-connected CI/CD) — IaC role.
#
# CLOUDFLARE RECOMMENDED OWNERSHIP SPLIT (must stay in sync with each
# apps/api/<name>/wrangler.toml's Ownership split comment block):
#
#   WORKERS BUILDS (Dashboard → Worker → Settings → Builds):
#     1. builds the code (Build command: corepack + pnpm install --frozen-lockfile
#        + pnpm turbo run build --filter=<pkg>)
#     2. uploads the Worker SCRIPT CONTENT / MODULE BUNDLE on every
#        git push (Deploy command: npx wrangler deploy)
#     3. applies runtime [vars] plus dashboard Variables & Secrets
#
#   TERRAFORM (this file and its neighbours):
#     ✓ Cloudflare ACCOUNT resources that CANNOT be known when
#       writing wrangler.toml: D1 IDs, KV IDs, Queue names, AI/DO
#       bindings — the AUTHORITATIVE binding manifest.
#     ✓ Cron trigger resources (cron.tf) that reference script names.
#     × NEVER the worker script content / module bundle.
#
# To avoid a permanent drift fight between Terraform and Workers
# Builds on the same `cloudflare_worker_script` every time a git push
# updates the bundle, EVERY `cloudflare_worker_script.*` below
# declares:
#
#   lifecycle {
#     ignore_changes = [content, module]
#   }
#
# meaning: "Terraform brings bindings into line but ignores any
# differences in the uploaded bundle, because Workers Builds owns
# that part of the object."  This is the recommended pattern whenever
# a Worker is deployed via Workers Builds and still bound to KV/D1/
# Queue/AI/DO through Terraform.
#
# IMPORTANT: Workers Builds IGNORES wrangler.toml's Custom Builds
# ([build]/[build.upload]).  The authoritative Build command lives in
# the Dashboard AND in the human-readable map at
# .cloudflare/workers-builds.yaml.  Keep all three in sync.
#
# After `terraform apply`, the operator copies values from
# `terraform output -json` into EITHER:
#   • each wrangler.toml's `REPLACE_WITH_*` placeholders, OR
#   • directly into the Cloudflare dashboard → Worker → Settings →
#     Variables and Secrets (preferred so commits don't encode IDs).
#
# The `cloudflare_worker_script` resources themselves are STILL
# declared: they act as the authoritative binding manifest, and the
# cron triggers in cron.tf reference `cloudflare_worker_script.*.name`.
# ============================================================

locals {
  # Worker names match the `name` field in each worker's wrangler.toml.
  # When using Workers Builds the Git bridge creates a script with this
  # exact name; Terraform only manages its bindings + downstream deps.
  worker_names = {
    gateway   = "${var.project_name}-gateway"
    user      = "${var.project_name}-user-service"
    graph     = "${var.project_name}-graph-service"
    ingestion = "${var.project_name}-ingestion-service"
    ai        = "${var.project_name}-ai-service"
    cleanup   = "${var.project_name}-cleanup-service"
  }
}

# ============================================================
# 1. Gateway Worker
#    • Cloudflare public entry point
#    • KV caches: JWT blacklist + rate limit
#    • All runtime configuration (USER_SERVICE_URL, JWT_SECRET, etc.)
#      lives in apps/api/gateway/wrangler.toml [vars] + dashboard Secrets.
# ============================================================
resource "cloudflare_worker_script" "gateway" {
  account_id = local.account_id
  name       = local.worker_names.gateway
  module     = true

  # Workers Builds uploads the actual JS bundle; Terraform only owns
  # the binding manifest below.  See header comment.
  lifecycle {
    ignore_changes = [content, module]
  }

  kv_namespace_binding {
    name         = "JWT_BLACKLIST"
    namespace_id = cloudflare_kv_namespace.caches["jwt-blacklist"].id
  }
  kv_namespace_binding {
    name         = "RATE_LIMIT"
    namespace_id = cloudflare_kv_namespace.caches["rate-limit"].id
  }
}

# ============================================================
# 2. User Service
#    • D1 decision-db (users / audit_logs / system_config tables)
#    • KV user-cache
#    • JWT / Neo4j env managed via wrangler.toml [vars] + Secrets.
# ============================================================
resource "cloudflare_worker_script" "user_service" {
  account_id = local.account_id
  name       = local.worker_names.user
  module     = true

  lifecycle {
    ignore_changes = [content, module]
  }

  d1_database_binding {
    name        = "DB"
    database_id = cloudflare_d1_database.decision_db.database_id
  }
  kv_namespace_binding {
    name         = "CACHE"
    namespace_id = cloudflare_kv_namespace.caches["user-cache"].id
  }
}

# ============================================================
# 3. Graph Service
#    • KV graph-cache
#    • Neo4j AuraDB credentials via wrangler.toml [vars] + Secrets.
# ============================================================
resource "cloudflare_worker_script" "graph_service" {
  account_id = local.account_id
  name       = local.worker_names.graph
  module     = true

  lifecycle {
    ignore_changes = [content, module]
  }

  kv_namespace_binding {
    name         = "CACHE"
    namespace_id = cloudflare_kv_namespace.caches["graph-cache"].id
  }
}

# ============================================================
# 4. Ingestion Service
#    • KV ingestion-jobs (pollable job status records)
#    • Queue ingestion-queue producer + consumer (this same worker
#      exports a `queue` handler; consumer limits declared in
#      wrangler.toml's [[queues_consumers]]).
#    • B2 staging-bucket credentials / bucket name live in
#      wrangler.toml [vars] + dashboard Secrets.
#    • Graph service URL cross-worker reference: written in
#      wrangler.toml [vars].
# ============================================================
resource "cloudflare_worker_script" "ingestion_service" {
  account_id = local.account_id
  name       = local.worker_names.ingestion
  module     = true

  lifecycle {
    ignore_changes = [content, module]
  }

  kv_namespace_binding {
    name         = "JOBS"
    namespace_id = cloudflare_kv_namespace.caches["ingestion-jobs"].id
  }
  queue_binding {
    name       = "INGEST_QUEUE"
    queue_name = cloudflare_queue.ingestion.name
  }
}

# ============================================================
# 5. AI Service
#    • Workers AI binding (free tier Neurons).
#    • D1 decision-db (decisions / recommendations tables; shared).
#    • KV ai-cache (inference cache + neuron-budget counter).
#    • Durable Object PlanningAgent — class declared in
#      apps/api/ai/wrangler.toml [[durable_objects.bindings]];
#      mirrored here for Terraform's dependency graph.
#    • LLM provider config, third-party API keys: wrangler.toml
#      [vars] + dashboard Secrets.
# ============================================================
resource "cloudflare_worker_script" "ai_service" {
  account_id = local.account_id
  name       = local.worker_names.ai
  module     = true

  lifecycle {
    ignore_changes = [content, module]
  }

  ai_binding {
    name = "AI"
  }
  d1_database_binding {
    name        = "DB"
    database_id = cloudflare_d1_database.decision_db.database_id
  }
  kv_namespace_binding {
    name         = "CACHE"
    namespace_id = cloudflare_kv_namespace.caches["ai-cache"].id
  }
  durable_object_binding {
    name       = "AGENT"
    class_name = "PlanningAgent"
  }
}

# ============================================================
# 6. Cleanup Service
#    • D1 decision-db (final row deletions after archival write).
#    • Queue cleanup-queue (one tenant per message; DLQ in queues.tf).
#    • KV caches: user/graph/ingestion-jobs/ai + CLEANUP_JOBS state.
#    • Dual B2 buckets (staging purge + archive write): B2 region,
#      bucket names, and credentials are in wrangler.toml [vars] +
#      dashboard Secrets.
#    • Neo4j credentials / tenant DROP authorizer: in wrangler.toml.
# ============================================================
resource "cloudflare_worker_script" "cleanup_service" {
  account_id = local.account_id
  name       = local.worker_names.cleanup
  module     = true

  lifecycle {
    ignore_changes = [content, module]
  }

  d1_database_binding {
    name        = "DB"
    database_id = cloudflare_d1_database.decision_db.database_id
  }
  queue_binding {
    name       = "CLEANUP_QUEUE"
    queue_name = cloudflare_queue.cleanup.name
  }
  kv_namespace_binding {
    name         = "USER_CACHE"
    namespace_id = cloudflare_kv_namespace.caches["user-cache"].id
  }
  kv_namespace_binding {
    name         = "GRAPH_CACHE"
    namespace_id = cloudflare_kv_namespace.caches["graph-cache"].id
  }
  kv_namespace_binding {
    name         = "INGESTION_JOBS"
    namespace_id = cloudflare_kv_namespace.caches["ingestion-jobs"].id
  }
  kv_namespace_binding {
    name         = "AI_CACHE"
    namespace_id = cloudflare_kv_namespace.caches["ai-cache"].id
  }
  kv_namespace_binding {
    name         = "CLEANUP_JOBS"
    namespace_id = cloudflare_kv_namespace.caches["cleanup-jobs"].id
  }
}
