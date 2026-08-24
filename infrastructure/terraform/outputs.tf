# ============================================================================
# Outputs: for human review / backfilling into Cloudflare Dashboard Variables & Secrets
#          (NEVER commit real IDs back to git)
# ============================================================================

output "project_name" {
  description = "Project prefix used in all resource naming."
  value       = var.project_name
}
output "environment" {
  description = "Environment suffix (production / staging)."
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
  description = "Shared D1 database resource name."
  value       = cloudflare_d1_database.shared_db.name
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
  description = "Cloudflare Queue resource names for ingestion and cleanup (main + DLQ)."
  value = {
    ingestion_main = cloudflare_queue.ingestion.queue_name
    ingestion_dlq  = cloudflare_queue.ingestion_dlq.queue_name
    cleanup_main   = cloudflare_queue.cleanup.queue_name
    cleanup_dlq    = cloudflare_queue.cleanup_dlq.queue_name
  }
}

# ---- Workers (merge Tier1 + Tier2 + Tier3 outputs) ----
output "workers" {
  description = "All Worker script metadata (name + compatibility_date), merged across Tier1/Tier2/Tier3."
  value = merge(
    {
      for k, w in cloudflare_workers_script.tier1 : k => {
        name               = w.script_name
        compatibility_date = w.compatibility_date
      }
    },
    {
      ingestion = {
        name               = cloudflare_workers_script.ingestion.script_name
        compatibility_date = cloudflare_workers_script.ingestion.compatibility_date
      },
      gateway = {
        name               = cloudflare_workers_script.gateway.script_name
        compatibility_date = cloudflare_workers_script.gateway.compatibility_date
      },
    },
  )
}

# ---- Service Bindings ----
output "gateway_service_bindings" {
  description = "Gateway Worker service bindings mapping (binding name → target worker name)."
  value = {
    for b in local.gateway_service_bindings :
    b.binding => local.workers[b.target].worker_name
  }
}
output "ingestion_service_bindings" {
  description = "Ingestion Worker service bindings mapping (binding name → target worker name)."
  value = {
    for b in local.ingestion_service_bindings :
    b.binding => local.workers[b.target].worker_name
  }
}

# ---- Cron ----
output "cleanup_cron_schedules" {
  description = "Cleanup Worker cron trigger schedules (daily 03:00 UTC)."
  value       = try(cloudflare_workers_cron_trigger.cleanup_daily["cleanup"].schedules, [])
}

# ---- Domains ----
output "worker_domains" {
  description = "Workers custom domain hostnames (empty if zone_id is not set)."
  value = {
    for k, r in cloudflare_workers_custom_domain.svc : k => r.hostname
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

# ============================================================================
# 7) apps/web Pages Project — Cloudflare default pages.dev domain,
#    no custom domain (per project spec).
# ============================================================================
output "pages_web_project" {
  description = "Frontend (apps/web) Cloudflare Pages Project metadata. Hosted via default pages.dev subdomain — no custom domain."
  value = {
    name      = cloudflare_pages_project.web.name
    id        = cloudflare_pages_project.web.id
    subdomain = cloudflare_pages_project.web.subdomain
    # Default reachable URL — ${subdomain}.pages.dev assigned by Cloudflare.
    # Domains list also includes this; we expose subdomain+domains for convenience.
    domains           = cloudflare_pages_project.web.domains
    production_branch = cloudflare_pages_project.web.production_branch
    created_on        = cloudflare_pages_project.web.created_on

    # Governance tags (Pages resource does not support a native `tags`
    # field — documented here for audit parity with Worker resources).
    governance_tags = [
      "Environment=${var.environment}",
      "Project=${var.project_name}",
      "Service=web",
      "Lifecycle=long-lived",
    ]
  }
}

output "pages_web_default_domain" {
  description = "Default Cloudflare-assigned pages.dev URL for the frontend SPA (no custom domain used). Use this URL once the first deployment has been made by CI (wrangler pages deploy apps/web/dist)."
  value       = try(cloudflare_pages_project.web.domains[0], "${cloudflare_pages_project.web.subdomain}.pages.dev")
}
