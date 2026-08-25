# ============================================================================
# Outputs: for human review / backfilling into Cloudflare Dashboard Variables & Secrets
#          (NEVER commit real IDs back to git)
#
# Workers Scripts / Pages / Cron / Service Bindings / Custom Domains are
# created/owned by wrangler deploy, not by Terraform — their metadata is
# NOT exported here. Run `wrangler deploy` + Cloudflare Dashboard for
# up-to-date Worker / Pages state.
# ============================================================================

output "project_name" {
  description = "Project prefix used in all resource naming."
  value       = var.project_name
}
output "environment" {
  description = "Environment suffix (single-environment system: production only)."
  value       = var.environment
}
output "zone_id" {
  description = "Cloudflare Zone ID for the custom domain (empty if not configured)."
  value       = var.zone_id
}

# ---- D1 ----
output "shared_database_id" {
  description = "Shared D1 database ID (binding name DB; shared by user/ai/cleanup)."
  value       = cloudflare_d1_database.shared_db.id
  sensitive   = true
}
output "shared_database_name" {
  description = "Shared D1 database resource name — matches [[d1_databases]].database_name in wrangler.toml."
  value       = cloudflare_d1_database.shared_db.name
}

# ---- KV ----
output "kv_namespaces" {
  description = "KV namespace metadata: svc / binding / title / id (id marked sensitive; only populate wrangler.toml via resolve-kv-ids.sh)."
  value = {
    for k, r in cloudflare_workers_kv_namespace.kv :
    k => {
      svc = split("__", k)[0]
      # state key is lowercase; upper() restores the original case to align with the wrangler.toml binding name
      binding = upper(split("__", k)[1])
      title   = r.title
      id      = r.id
    }
  }
  sensitive = true
}

# ---- Queues ----
output "queues" {
  description = "Cloudflare Queue resource names for ingestion and cleanup (main + DLQ). Matches [[queues.producers/consumers]].queue in wrangler.toml."
  value = {
    ingestion_main = cloudflare_queue.ingestion.queue_name
    ingestion_dlq  = cloudflare_queue.ingestion_dlq.queue_name
    cleanup_main   = cloudflare_queue.cleanup.queue_name
    cleanup_dlq    = cloudflare_queue.cleanup_dlq.queue_name
  }
}

# ---- Service convention (metadata-only; NOT created by Terraform) ----
output "service_convention" {
  description = "Expected Worker / Pages names per service (created by wrangler deploy). Cross-check with deploy.yml DEFAULTS_MATRIX and each wrangler.toml `name =` field."
  value = {
    for svc, meta in local.workers : svc => {
      worker_name = "${local.res_prefix}-${svc}"
      has_db      = meta.has_db
    }
  }
}

output "pages_web_project_name" {
  description = "Expected Cloudflare Pages Project name for the frontend SPA (created by `wrangler pages deploy` — upsert semantics on first deploy)."
  value       = "${local.res_prefix}-web"
}

output "durable_object_classes" {
  description = "AI Worker Durable Object class list (metadata-only parity with apps/api/ai/wrangler.toml [[migrations]] v1; class code uploaded by Wrangler)."
  value       = local.durable_object_classes
}

# ============================================================================
# External dependencies (Terraform does not create them; for manual cross-check
# against wrangler.toml [vars])
# ============================================================================
output "external_backblaze_b2" {
  description = "Backblaze B2 external dependency metadata (buckets are managed externally; for wrangler.toml cross-check)."
  value = {
    region           = var.b2_region
    ingestion_bucket = var.b2_ingestion_bucket
    archive_bucket   = var.b2_archive_bucket
    required_bucket_tags = {
      Environment = var.environment
      Project     = var.project_name
      Service     = "shared (ingestion + cleanup)"
      Lifecycle   = "long-lived"
    }
  }
}

output "external_neo4j_auradb" {
  description = "Neo4j AuraDB external dependency metadata (instance is managed externally; for wrangler.toml cross-check)."
  value = {
    url_placeholder = var.neo4j_url_placeholder
    user            = var.neo4j_user
    database        = var.neo4j_database
  }
}
