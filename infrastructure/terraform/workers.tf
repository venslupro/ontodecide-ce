# ============================================================
# Workers Builds (Git-connected CI/CD) — IaC role.
#
# Cloudflare's Workers Builds (托管式 Git 集成) is the canonical,
# zero-configuration way to build and deploy the workers. The build
# system:
#   1. reads each wrangler.toml in apps/api/*/
#   2. runs `pnpm turbo run build` (declared in [build])
#   3. uploads the compiled worker via Cloudflare's internal Git bridge
#   4. applies [vars] and any dashboard-set Secrets as the runtime env
#
# As a result, Terraform NO LONGER owns:
#   × worker script content (content = file("dist/index.js"))
#   × plain_text / secret_text bindings that are pure configuration
#     (URLs, flags, B2 region, JWT secrets, Neo4j credentials, etc.)
#
# Terraform KEEPS ownership of resources whose IDs originate INSIDE
# the Cloudflare account / B2 project and therefore cannot be known
# when writing wrangler.toml ahead of time:
#   ✓ D1 database IDs
#   ✓ KV namespace IDs
#   ✓ Queue names / queue consumer bindings
#   ✓ AI binding
#   ✓ Durable Object bindings (declared in wrangler.toml, mirrored
#     here so Terraform's dependency graph stays correct)
#
# After `terraform apply`, the operator copies values from
# `terraform output -json` into:
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
