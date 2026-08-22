# ============================================================================
# 输出：便于人工审阅 / 回填到 Cloudflare Dashboard Variables & Secrets
#       (严禁把真实 ID 写回 git)
# ============================================================================

output "project_name" { value = var.project_name }
output "environment" { value = var.environment }
output "zone_id" { value = var.zone_id }

# ---- D1 ----
output "decision_database_id" {
  description = "共享决策 D1 数据库 ID (绑定名 DB; user/ai/cleanup 三服务共享)。"
  value       = cloudflare_d1_database.decision_db.id
  sensitive   = true
}
output "decision_database_name" {
  value = cloudflare_d1_database.decision_db.name
}

# ---- KV ----
output "kv_namespaces" {
  description = "KV namespace 元数据：svc / binding / title (id 不输出，避免意外泄露)。"
  value = {
    for k, r in cloudflare_workers_kv_namespace.kv :
    k => {
      svc     = split("__", k)[0]
      binding = split("__", k)[1]
      title   = r.title
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

# ---- Workers ----
output "workers" {
  value = {
    for k, w in cloudflare_workers_script.svc : k => {
      name               = w.name
      compatibility_date = w.compatibility_date
    }
  }
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
  description = "AI Worker Durable Object 类清单。类代码由 Wrangler [[migrations]] v1 上传。"
  value       = local.durable_object_classes
}

# ============================================================================
# 外部依赖 (Terraform 不直接创建，仅方便人工核对 wrangler.toml [vars])
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
