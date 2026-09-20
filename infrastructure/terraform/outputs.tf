# ============================================================================
# Outputs: for human review / backfilling into Cloudflare Dashboard Variables & Secrets
#          (NEVER commit real IDs back to git)
#
# Workers Scripts / Pages / Cron / Service Bindings / Custom Domains are
# created/owned by wrangler deploy, not by Terraform — their metadata is
# NOT exported here. Run `wrangler deploy` + Cloudflare Dashboard for
# up-to-date Worker / Pages state.
#
# Sensitive outputs (marked sensitive = true):
#   • Are masked as (sensitive value) in `terraform plan` / `terraform output`
#   • Are NOT masked in `terraform output -json` — use text output in CI
#   • Are auto-pushed to GitHub Secrets/Variables by terraform.yml after apply
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
# Backblaze B2 data buckets (Terraform-managed)
#    Bucket names match wrangler.toml [vars]: B2_INGESTION_BUCKET / B2_ARCHIVE_BUCKET
# ============================================================================
output "b2_buckets" {
  description = "B2 data buckets created and managed by Terraform."
  value = {
    region = var.b2_region
    ingestion_staging = {
      name       = b2_bucket.ingestion_staging.bucket_name
      bucket_id  = b2_bucket.ingestion_staging.bucket_id
      account_id = b2_bucket.ingestion_staging.account_id
    }
    tenant_archive = {
      name       = b2_bucket.tenant_archive.bucket_name
      bucket_id  = b2_bucket.tenant_archive.bucket_id
      account_id = b2_bucket.tenant_archive.account_id
    }
  }
}

# ============================================================================
# B2 Worker Application Key (least-privilege, bucket-scoped)
#    Terraform creates this key restricted to the two data buckets with
#    listFiles / readFiles / writeFiles / deleteFiles capabilities.
#    Pushed to GitHub Secrets (B2_KEY_ID / B2_KEY) after apply.
#    The B2 Master Key (B2_MASTER_KEY_ID / B2_MASTER_KEY) used by Terraform
#    itself is NOT exported — it stays only in GitHub Secrets for the TF run.
# ============================================================================
output "b2_worker_key" {
  description = "B2 application key for ingestion/cleanup workers (bucket-scoped, least-privilege). Sensitive — pushed to GitHub Secrets B2_KEY_ID / B2_KEY."
  value = {
    application_key_id = b2_application_key.worker.application_key_id
    application_key    = b2_application_key.worker.application_key
    key_name           = b2_application_key.worker.key_name
  }
  sensitive = true
}

# ============================================================================
# Neo4j AuraDB instance (Terraform-managed)
#    Connection details are auto-pushed to GitHub by terraform.yml after apply:
#      NEO4J_URI      ← connection_url  (Repository Variable)
#      NEO4J_USERNAME  ← username        (Repository Variable)
#      NEO4J_PASSWORD  ← password        (Repository Secret)
#      NEO4J_DATABASE   ← "neo4j"         (Repository Variable, AuraDB default)
# ============================================================================
output "neo4j_instance" {
  description = "Neo4j AuraDB instance created and managed by Terraform. Sensitive — auto-pushed to GitHub Secrets/Variables."
  value = {
    name           = neo4jaura_instance.neo4j.name
    instance_id    = neo4jaura_instance.neo4j.instance_id
    connection_url = neo4jaura_instance.neo4j.connection_url
    username       = neo4jaura_instance.neo4j.username
    password       = neo4jaura_instance.neo4j.password
    cloud_provider = neo4jaura_instance.neo4j.cloud_provider
    region         = neo4jaura_instance.neo4j.region
    type           = neo4jaura_instance.neo4j.type
  }
  sensitive = true
}
