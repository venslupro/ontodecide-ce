# ============================================================================
# Outputs: for human review / backfilling into Cloudflare Dashboard Variables & Secrets
#          (NEVER commit real IDs back to git)
# ============================================================================

output "project_name" { value = var.project_name }
output "environment" { value = var.environment }
output "zone_id" { value = var.zone_id }

# ---- D1 ----
output "shared_database_id" {
  description = "Shared D1 database ID (binding name DB; shared by user/ai/cleanup)."
  value       = cloudflare_d1_database.shared_db.id
  sensitive   = true
}
output "shared_database_name" {
  value = cloudflare_d1_database.shared_db.name
}

# ---- KV ----
output "kv_namespaces" {
  description = "KV namespace metadata: svc / binding / title (id not exported to avoid accidental leakage)."
  value = {
    for k, r in cloudflare_workers_kv_namespace.kv :
    k => {
      svc = split("__", k)[0]
      # state key is lowercase; upper() restores the original case to align with the wrangler.toml binding name
      binding = upper(split("__", k)[1])
    }
  }
}

# ---- Queues ----
output "queues" {
  value = {
    ingestion_main = cloudflare_queue.ingestion.name
    ingestion_dlq  = cloudflare_queue.ingestion_dlq.name
    cleanup_main   = cloudflare_queue.cleanup.name
    cleanup_dlq    = cloudflare_queue.cleanup_dlq.name
  }
}

# ---- Workers (merge Tier1 + Tier2 + Tier3 outputs) ----
output "workers" {
  value = merge(
    {
      for k, w in cloudflare_workers_script.tier1 : k => {
        name               = w.name
        compatibility_date = w.compatibility_date
      }
    },
    {
      ingestion = {
        name               = cloudflare_workers_script.ingestion.name
        compatibility_date = cloudflare_workers_script.ingestion.compatibility_date
      },
      gateway = {
        name               = cloudflare_workers_script.gateway.name
        compatibility_date = cloudflare_workers_script.gateway.compatibility_date
      },
    },
  )
}

# ---- Service Bindings ----
output "gateway_service_bindings" {
  value = {
    for b in local.gateway_service_bindings :
    b.binding => local.workers[b.target].worker_name
  }
}
output "ingestion_service_bindings" {
  value = {
    for b in local.ingestion_service_bindings :
    b.binding => local.workers[b.target].worker_name
  }
}

# ---- Cron ----
output "cleanup_cron_schedules" {
  value = try(cloudflare_workers_cron_trigger.cleanup_daily["cleanup"].schedules, [])
}

# ---- Domains ----
output "worker_domains" {
  value = {
    for k, r in cloudflare_workers_domain.svc : k => r.hostname
  }
}

# ---- Durable Object ----
output "durable_object_classes" {
  description = "AI Worker Durable Object class list. Class code is uploaded via Wrangler [[migrations]] v1."
  value       = local.durable_object_classes
}

# ============================================================================
# External dependencies (Terraform does not create them; for manual cross-check
# against wrangler.toml [vars])
# ============================================================================
output "external_backblaze_b2" {
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
  value = {
    url_placeholder = var.neo4j_url_placeholder
    user            = var.neo4j_user
    database        = var.neo4j_database
  }
}
