# ============================================================
# Worker scripts + bindings.
#
# IMPORTANT: with Cloudflare Workers Builds (Git-connected CI/CD), the
# worker CODE is uploaded by the build system on every push. Terraform's
# job here is to provision the *bindings* (D1, KV, R2, Queue, DO, AI) so
# the dashboard-deployed workers see the right resources.
#
# Two deployment modes are supported:
#
#   1. Workers Builds (recommended): comment out the `content` lines
#      below, keep only the bindings. Each `cloudflare_worker_script`
#      becomes a binding manifest that the build system reads when
#      deploying.
#
#   2. Manual deploy via `wrangler deploy`: keep the `content` lines
#      (they point at the built `dist/index.js`); running `terraform
#      apply` will upload the worker code as well.
# ============================================================

locals {
  # Worker names match the `name` field in each worker's wrangler.toml.
  worker_names = {
    gateway   = "${var.project_name}-gateway"
    user      = "${var.project_name}-user-service"
    graph     = "${var.project_name}-graph-service"
    ingestion = "${var.project_name}-ingestion-service"
    ai        = "${var.project_name}-ai-service"
    cleanup   = "${var.project_name}-cleanup-service"
  }

  # Common bindings shared by every worker.
  common_bindings = [
    {name = "JWT_SECRET", type = "secret_text", text = var.jwt_secret},
  ]
}

# ============================================================
# 1. Gateway Worker
# ============================================================
resource "cloudflare_worker_script" "gateway" {
  account_id = local.account_id
  name       = local.worker_names.gateway
  module     = true

  # Comment out the next line when deploying via Workers Builds only.
  content = file("${path.module}/../../apps/api/gateway/dist/index.js")

  kv_namespace_binding {
    name         = "JWT_BLACKLIST"
    namespace_id = cloudflare_kv_namespace.caches["jwt-blacklist"].id
  }
  kv_namespace_binding {
    name         = "RATE_LIMIT"
    namespace_id = cloudflare_kv_namespace.caches["rate-limit"].id
  }

  secret_text_binding {
    name = "JWT_SECRET"
    text = var.jwt_secret
  }

  # Routing URLs: each downstream worker's workers.dev subdomain.
  plain_text_binding {
    name = "USER_SERVICE_URL"
    text = "https://${local.worker_names.user}.${var.cloudflare_account_id_or_workers_dev}.workers.dev"
  }
}

# ============================================================
# 2. User Service
# ============================================================
resource "cloudflare_worker_script" "user_service" {
  account_id = local.account_id
  name       = local.worker_names.user
  module     = true

  content = file("${path.module}/../../apps/api/user/dist/index.js")

  d1_database_binding {
    name        = "DB"
    database_id = cloudflare_d1_database.decision_db.database_id
  }
  kv_namespace_binding {
    name         = "CACHE"
    namespace_id = cloudflare_kv_namespace.caches["user-cache"].id
  }
  secret_text_binding {
    name = "JWT_SECRET"
    text = var.jwt_secret
  }
}

# ============================================================
# 3. Graph Service
# ============================================================
resource "cloudflare_worker_script" "graph_service" {
  account_id = local.account_id
  name       = local.worker_names.graph
  module     = true

  content = file("${path.module}/../../apps/api/graph/dist/index.js")

  kv_namespace_binding {
    name         = "CACHE"
    namespace_id = cloudflare_kv_namespace.caches["graph-cache"].id
  }
  secret_text_binding {
    name = "JWT_SECRET"
    text = var.jwt_secret
  }
  plain_text_binding {
    name = "NEO4J_URL"
    text = var.neo4j_url
  }
  plain_text_binding {
    name = "NEO4J_USER"
    text = var.neo4j_user
  }
  secret_text_binding {
    name = "NEO4J_PASSWORD"
    text = var.neo4j_password
  }
}

# ============================================================
# 4. Ingestion Service
# ============================================================
resource "cloudflare_worker_script" "ingestion_service" {
  account_id = local.account_id
  name       = local.worker_names.ingestion
  module     = true

  content = file("${path.module}/../../apps/api/ingestion/dist/index.js")

  r2_bucket_binding {
    name        = "BUCKET"
    bucket_name = cloudflare_r2_bucket.ingestion.name
  }
  kv_namespace_binding {
    name         = "JOBS"
    namespace_id = cloudflare_kv_namespace.caches["ingestion-jobs"].id
  }
  queue_binding {
    name         = "INGEST_QUEUE"
    queue_name   = cloudflare_queue.ingestion.name
  }
  secret_text_binding {
    name = "JWT_SECRET"
    text = var.jwt_secret
  }
  plain_text_binding {
    name = "GRAPH_SERVICE_URL"
    text = "https://${local.worker_names.graph}.${var.cloudflare_account_id_or_workers_dev}.workers.dev"
  }
}

# ============================================================
# 5. AI Service
# ============================================================
resource "cloudflare_worker_script" "ai_service" {
  account_id = local.account_id
  name       = local.worker_names.ai
  module     = true

  content = file("${path.module}/../../apps/api/ai/dist/index.js")

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
  secret_text_binding {
    name = "JWT_SECRET"
    text = var.jwt_secret
  }
  plain_text_binding {
    name = "AI_DEFAULT_PROVIDER"
    text = var.default_provider
  }
  plain_text_binding {
    name = "WORKERS_AI_MODEL"
    text = var.workers_ai_model
  }
}

# ============================================================
# 6. Cleanup Service
# ============================================================
resource "cloudflare_worker_script" "cleanup_service" {
  account_id = local.account_id
  name       = local.worker_names.cleanup
  module     = true

  content = file("${path.module}/../../apps/api/cleanup/dist/index.js")

  d1_database_binding {
    name        = "DB"
    database_id = cloudflare_d1_database.decision_db.database_id
  }
  r2_bucket_binding {
    name        = "BUCKET"
    bucket_name = cloudflare_r2_bucket.cleanup_archive.name
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
  secret_text_binding {
    name = "JWT_SECRET"
    text = var.jwt_secret
  }
  plain_text_binding {
    name = "NEO4J_URL"
    text = var.neo4j_url
  }
  plain_text_binding {
    name = "NEO4J_USER"
    text = var.neo4j_user
  }
  secret_text_binding {
    name = "NEO4J_PASSWORD"
    text = var.neo4j_password
  }
}
