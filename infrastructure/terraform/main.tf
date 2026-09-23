# ============================================================================
# OntoDecide — Cloudflare long-lived resources IaC manifest
# Cloudflare Provider schema (unified bindings, object attrs)
#
# Scope (Shift Left · static resource layer):
#   • D1 shared database "shared-db" (shared by user/ai/cleanup)
#   • All KV namespaces for the 6 workers
#   • Ingestion / Cleanup main queues + DLQs (DLQ bindings live in wrangler.toml consumer)
#   • Service naming convention + binding name metadata for review/audit
#
# Out of scope (code layer · handled by deploy.yml + wrangler.toml):
#   • Workers Scripts (gateway / user / graph / ingestion / ai / cleanup)
#     — created / updated / destroyed by `wrangler deploy` in deploy.yml
#   • Workers Service Bindings between workers — declared in wrangler.toml [[services]]
#   • Workers Cron triggers — declared in wrangler.toml [triggers].crons
#   • Workers Observability — declared in wrangler.toml [observability]
#   • Workers Custom Domains (api.ontodecide.com) — wrangler / Dashboard managed
#   • Cloudflare Pages Project (apps/web SPA) — created by `wrangler pages deploy`
#   • Worker script code versions (Wrangler Action)
#   • [vars] plain-text env vars (native to wrangler.toml)
#   • Workers AI [ai] binding (handled by wrangler.toml [ai])
#   • Durable Object class upload — handled by wrangler.toml [[migrations]] tag=v1
#   • Queue consumer / DLQ binding — wrangler.toml [[queues.consumers]] dead_letter_queue
#   • D1 migration SQL — scripts/migrate.sh --remote runs after all deploys succeed
#   • Terraform state bucket (ontodecide-prd-tf-state) — bootstrap
#     dependency, manually created (chicken-and-egg with S3 backend)
#
# Naming convention (unified):
#   ${project_name}-${env_short}-${service}[-${suffix}]
#   Examples: ontodecide-prd-gateway, ontodecide-prd-graph, ontodecide-prd-shared-db
#             ontodecide-prd-ingestion, ontodecide-prd-ingestion-dlq
#             ontodecide-prd-gateway-jwt-blacklist (KV title lowercase + hyphens)
#
# Single-environment system: production only — no preview/staging environments.
# ============================================================================

# -------- Unified naming locals --------
locals {
  # Env short form: production→prd, staging→stg.
  # Derived from var.environment (injected by terraform.yml via TF_VAR_environment).
  # Staging not yet in use; only production is deployed today.
  env_short = var.environment == "production" ? "prd" : (var.environment == "staging" ? "stg" : var.environment)

  # Unified resource name prefix: ontodecide-prd
  res_prefix = "${var.project_name}-${local.env_short}"

  # Service metadata (for naming convention + audit cross-check with wrangler.toml).
  # has_db = true indicates the worker declares [[d1_databases]] binding "DB"
  # pointing at cloudflare_d1_database.shared_db.name in its wrangler.toml.
  workers = {
    gateway   = { service = "gateway", has_db = false }
    user      = { service = "user", has_db = true }
    graph     = { service = "graph", has_db = false }
    ingestion = { service = "ingestion", has_db = false }
    ai        = { service = "ai", has_db = true }
    cleanup   = { service = "cleanup", has_db = true }
  }

  kv_binding_map = [
    { svc = "gateway", binding = "JWT_BLACKLIST" },
    { svc = "gateway", binding = "RATE_LIMIT" },
    { svc = "user", binding = "CACHE" },
    { svc = "ingestion", binding = "JOBS" },
    { svc = "cleanup", binding = "USER_CACHE" },
    { svc = "cleanup", binding = "INGESTION_JOBS" },
    { svc = "cleanup", binding = "AI_CACHE" },
    { svc = "cleanup", binding = "CLEANUP_JOBS" },
  ]

  # Durable Object class list (class code declared in ai/wrangler.toml [[migrations]] v1).
  # Documented here for audit parity with the wrangler.toml declaration.
  durable_object_classes = {
    AGENT = "PlanningAgent"
  }
}

# ============================================================================
# 1) D1 shared database: ${res_prefix}-shared-db
#    Shared by user / ai / cleanup (has_db=true). Naming convention:
#      ${project}-${env}-shared-db   service=shared expresses cross-service sharing
#                                   suffix=db    identifies resource type
# ============================================================================
resource "cloudflare_d1_database" "shared_db" {
  account_id = var.account_id
  name       = "${local.res_prefix}-shared-db"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=shared Lifecycle=long-lived
}

# ============================================================================
# 2) KV Namespaces (9)
#    Naming convention (Cloudflare resource name / Google Cloud naming convention):
#      • title         lowercase + hyphens  e.g. ontodecide-prd-cleanup-cleanup-jobs
#      • for_each key  lowercase + double-underscore separator (TF state internal id, not a cloud resource name)
#                      e.g. cleanup__cleanup_jobs
#    Note: kv_binding_map.binding itself stays UPPER_SNAKE_CASE,
#          because it maps to the wrangler.toml binding name (JS env var env.XXX).
#          Here we only convert to lowercase via lower()/replace() at naming time.
# ============================================================================
resource "cloudflare_workers_kv_namespace" "kv" {
  for_each = {
    for idx, item in local.kv_binding_map :
    # state key lowercase (TF internal id, aligned with cloud naming convention)
    "${item.svc}__${lower(item.binding)}" => item
  }

  account_id = var.account_id
  # title is the Cloudflare resource display name; lowercase + hyphens per Cloudflare naming convention
  # (binding field keeps UPPER_SNAKE_CASE for wrangler.toml; conversion happens here only)
  title = "${local.res_prefix}-${each.value.svc}-${lower(replace(each.value.binding, "_", "-"))}"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=${each.value.svc} Lifecycle=long-lived
}

# ============================================================================
# 3) Queues: ingestion + cleanup (main + DLQ created separately)
#    consumer's dead_letter_queue binding is handled by wrangler.toml [[queues.consumers]]
# ============================================================================
resource "cloudflare_queue" "ingestion_dlq" {
  account_id = var.account_id
  queue_name = "${local.res_prefix}-ingestion-dlq"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=ingestion Lifecycle=long-lived
}

resource "cloudflare_queue" "ingestion" {
  account_id = var.account_id
  queue_name = "${local.res_prefix}-ingestion"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=ingestion Lifecycle=long-lived
}

resource "cloudflare_queue" "cleanup_dlq" {
  account_id = var.account_id
  queue_name = "${local.res_prefix}-cleanup-dlq"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=cleanup Lifecycle=long-lived
}

resource "cloudflare_queue" "cleanup" {
  account_id = var.account_id
  queue_name = "${local.res_prefix}-cleanup"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=cleanup Lifecycle=long-lived
}

# ============================================================================
# 4) Backblaze B2 data buckets (Terraform-managed via Backblaze/b2 provider)
#
#    Two private buckets for the ingestion → cleanup data lifecycle:
#      • ingestion-staging: uploaded files await ETL processing (Ingestion)
#      • tenant-archive:    archived tenant data after cleanup (Cleanup)
#
#    Naming: ${res_prefix}-{service}-{component}
#      e.g. ontodecide-prd-ingestion-staging, ontodecide-prd-tenant-archive
#
#    The Terraform state bucket (ontodecide-prd-tf-state) is NOT
#    managed here — it is a bootstrap dependency for the S3 backend.
# ============================================================================
resource "b2_bucket" "ingestion_staging" {
  bucket_name = var.b2_ingestion_bucket
  bucket_type = "allPrivate"

  bucket_info = {
    environment = lower(var.environment)
    project     = var.project_name
    service     = "ingestion"
    component   = "staging"
    lifecycle   = "long-lived"
  }
}

resource "b2_bucket" "tenant_archive" {
  bucket_name = var.b2_archive_bucket
  bucket_type = "allPrivate"

  bucket_info = {
    environment = lower(var.environment)
    project     = var.project_name
    service     = "cleanup"
    component   = "archive"
    lifecycle   = "long-lived"
  }
}

# ---------------------------------------------------------------------------
# B2 Application Key for Workers (least-privilege, bucket-scoped)
#
# Terraform authenticates with the B2 Master Key (B2_MASTER_KEY_ID /
# B2_MASTER_KEY) to create buckets + this key. The application key is
# restricted to the two data buckets with only the capabilities the
# ingestion & cleanup workers need (list / read / write / delete files).
#
# The key ID + secret are exported as a sensitive output; deploy.yml reads
# it from state and uploads it as the ingestion + cleanup Worker Secrets
# B2_KEY_ID / B2_KEY — workers never hold the master key, and the key
# never passes through GitHub Secrets.
# ---------------------------------------------------------------------------
resource "b2_application_key" "worker" {
  key_name = "${local.res_prefix}-worker-b2"

  capabilities = [
    "listFiles",
    "readFiles",
    "writeFiles",
    "deleteFiles",
  ]

  bucket_ids = [
    b2_bucket.ingestion_staging.bucket_id,
    b2_bucket.tenant_archive.bucket_id,
  ]
}

# ============================================================================
# 5) Neo4j AuraDB instance (Terraform-managed via neo4j-labs/neo4jaura provider)
#
#    Single Neo4j Aura instance for graph storage:
#      • Used by Graph Worker (NEO4J_URI / NEO4J_USERNAME / NEO4J_DATABASE)
#      • Password is a sensitive output — uploaded by deploy.yml as Worker Secret NEO4J_PASSWORD
#      • Defaults to AuraDB Free (var.neo4j_type = "free-db"); memory /
#        storage stay null for the free tier's fixed size
#
#    Naming: ${res_prefix}-neo4j  e.g. ontodecide-prd-neo4j
#
#    prevent_destroy: avoids accidental `terraform destroy` deleting
#    production graph data. To destroy, remove the lifecycle block first.
# ============================================================================
data "neo4jaura_projects" "this" {}

resource "neo4jaura_instance" "neo4j" {
  name           = "${local.res_prefix}-neo4j"
  cloud_provider = var.neo4j_cloud_provider
  region         = var.neo4j_region
  type           = var.neo4j_type
  memory         = var.neo4j_memory
  storage        = var.neo4j_storage
  version        = var.neo4j_version
  project_id     = data.neo4jaura_projects.this.projects[0].id

  lifecycle {
    prevent_destroy = true
  }
}

# ============================================================================
# NOTE: Sections 6–9 (Workers Script tiers, Cron trigger, Custom domains,
#       Pages project) have been moved entirely to wrangler.toml + deploy.yml.
#
# Why this separation works:
#   • D1 / KV / Queues / B2 / Neo4j have stable IDs and cross-referencing
#     constraints that benefit from declarative IaC ordering + drift correction.
#   • Workers Scripts / Pages are code-coupled (script content, bindings,
#     [vars], [ai], DO classes, [observability], cron, service bindings)
#     and change every deploy — wrangler deploy handles them as one
#     atomic PUT each time, and creates the resource automatically on
#     the first deploy (upsert / PUT-if-absent semantics).
#   • Service Binding ordering (L1→L2→L3) is enforced by deploy.yml job
#     `needs:` dependency graph (identical to the former TF tier split).
#
# See each apps/api/*/wrangler.toml and .github/workflows/deploy.yml for
# the code-layer resource declarations.
#
# If you need a Worker-sentinel / metadata-only TF pattern again in the
# future (e.g., pre-creating Service Binding targets before any code
# deploy runs), restore the old Tier1/2/3 cloudflare_workers_script
# blocks from git history. Under the current model the first deploy
# simply creates the Worker via wrangler, and downstream Service
# Bindings resolve on subsequent layers.
# ============================================================================
