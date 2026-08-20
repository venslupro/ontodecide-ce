# ============================================================
# KV namespaces.
#
# Six workers share their caches via these namespaces; each binding name
# in the worker wrangler.toml matches a `cloudflare_kv_namespace` resource
# below.
# ============================================================

locals {
  kv_namespaces = {
    user_cache      = "user-cache"
    graph_cache     = "graph-cache"
    ingestion_jobs  = "ingestion-jobs"
    ai_cache        = "ai-cache"
    cleanup_jobs    = "cleanup-jobs"
    jwt_blacklist   = "jwt-blacklist"
    rate_limit      = "rate-limit"
  }
}

resource "cloudflare_kv_namespace" "caches" {
  for_each   = toset([for k, v in local.kv_namespaces : v])
  account_id = local.account_id
  title      = "${var.project_name}-${each.key}-${var.environment}"
}
