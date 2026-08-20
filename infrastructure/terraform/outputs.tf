# ============================================================
# Useful outputs for downstream scripts (deploy.sh, migrate.sh).
# ============================================================

output "account_id" {
  value = local.account_id
}

output "d1_database_id" {
  value = cloudflare_d1_database.decision_db.database_id
}

output "kv_namespaces" {
  value = {
    for k, ns in cloudflare_kv_namespace.caches : k => ns.id
  }
}

output "r2_buckets" {
  value = {
    ingestion = cloudflare_r2_bucket.ingestion.name
    archive   = cloudflare_r2_bucket.cleanup_archive.name
  }
}

output "queues" {
  value = {
    ingestion        = cloudflare_queue.ingestion.name
    ingestion_dlq    = cloudflare_queue.ingestion_dlq.name
    cleanup          = cloudflare_queue.cleanup.name
    cleanup_dlq      = cloudflare_queue.cleanup_dlq.name
  }
}

output "worker_names" {
  value = {
    gateway    = cloudflare_worker_script.gateway.name
    user       = cloudflare_worker_script.user_service.name
    graph      = cloudflare_worker_script.graph_service.name
    ingestion  = cloudflare_worker_script.ingestion_service.name
    ai         = cloudflare_worker_script.ai_service.name
    cleanup    = cloudflare_worker_script.cleanup_service.name
  }
}
