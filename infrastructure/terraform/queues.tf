# ============================================================
# Queues: ingestion-queue + cleanup-queue, each with a dead-letter queue.
# ============================================================

resource "cloudflare_queue" "ingestion" {
  account_id = local.account_id
  name       = "${var.project_name}-ingestion-${var.environment}"
}

resource "cloudflare_queue" "ingestion_dlq" {
  account_id = local.account_id
  name       = "${var.project_name}-ingestion-dlq-${var.environment}"
}

resource "cloudflare_queue" "cleanup" {
  account_id = local.account_id
  name       = "${var.project_name}-cleanup-${var.environment}"
}

resource "cloudflare_queue" "cleanup_dlq" {
  account_id = local.account_id
  name       = "${var.project_name}-cleanup-dlq-${var.environment}"
}

# Consumer bindings: each queue has one consumer Worker.
# Cloudflare's queue consumer is configured in the worker's wrangler.toml
# ([[queues_consumers]] block); this resource wires the DLQ reference.
