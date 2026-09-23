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
#   • Are read from remote state by deploy.yml (.github/actions/tf-outputs)
#     and uploaded as Worker Secrets (never to GitHub Secrets, logs, or
#     artifacts)
#
# CONTRACT: .github/actions/tf-outputs reads b2_worker_key, neo4j_password
# and neo4j_instance by name/shape straight from state — keep it in sync
# when renaming or restructuring those outputs.
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
#    account_id is deliberately NOT exported: the B2 account ID equals the
#    master key's keyID, and this output is printed in public CI logs.
# ============================================================================
output "b2_buckets" {
  description = "B2 data buckets created and managed by Terraform."
  value = {
    region = var.b2_region
    ingestion_staging = {
      name      = b2_bucket.ingestion_staging.bucket_name
      bucket_id = b2_bucket.ingestion_staging.bucket_id
    }
    tenant_archive = {
      name      = b2_bucket.tenant_archive.bucket_name
      bucket_id = b2_bucket.tenant_archive.bucket_id
    }
  }
}

# ============================================================================
# B2 Worker Application Key (least-privilege, bucket-scoped)
#    Terraform creates this key restricted to the two data buckets with
#    listFiles / readFiles / writeFiles / deleteFiles capabilities.
#    Uploaded as Worker Secrets B2_KEY_ID / B2_KEY (ingestion + cleanup)
#    by deploy.yml, read from state.
#    The B2 Master Key (B2_MASTER_KEY_ID / B2_MASTER_KEY) used by Terraform
#    itself is NOT exported — it stays only in GitHub Secrets for the TF run.
# ============================================================================
output "b2_worker_key" {
  description = "B2 application key for ingestion/cleanup workers (bucket-scoped, least-privilege). Sensitive — uploaded as Worker Secrets B2_KEY_ID / B2_KEY by deploy.yml."
  value = {
    application_key_id = b2_application_key.worker.application_key_id
    application_key    = b2_application_key.worker.application_key
    key_name           = b2_application_key.worker.key_name
  }
  sensitive = true
}

# ============================================================================
# Neo4j AuraDB instance (Terraform-managed)
#    Connection details are NOT secret — deploy.yml reads them from state
#    and patches NEO4J_URI / NEO4J_USERNAME in wrangler.toml [vars].
#    The password is a separate sensitive output, uploaded by deploy.yml
#    as Worker Secret NEO4J_PASSWORD (graph + cleanup).
# ============================================================================
output "neo4j_instance" {
  description = "Neo4j AuraDB instance metadata + connection details (non-sensitive; patched into wrangler.toml [vars] by deploy.yml)."
  value = {
    name           = neo4jaura_instance.neo4j.name
    instance_id    = neo4jaura_instance.neo4j.instance_id
    connection_url = neo4jaura_instance.neo4j.connection_url
    username       = neo4jaura_instance.neo4j.username
    cloud_provider = neo4jaura_instance.neo4j.cloud_provider
    region         = neo4jaura_instance.neo4j.region
    type           = neo4jaura_instance.neo4j.type
  }
}

output "neo4j_password" {
  description = "Neo4j AuraDB database password. Sensitive — uploaded as Worker Secret NEO4J_PASSWORD (graph + cleanup) by deploy.yml."
  value       = neo4jaura_instance.neo4j.password
  sensitive   = true
}
