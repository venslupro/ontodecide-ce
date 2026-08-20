# ============================================================
# R2 buckets: ingestion staging + cleanup archive.
# ============================================================

resource "cloudflare_r2_bucket" "ingestion" {
  account_id = local.account_id
  name       = "${var.project_name}-ingestion-${var.environment}"
  location   = "APAC"
}

resource "cloudflare_r2_bucket" "cleanup_archive" {
  account_id = local.account_id
  name       = "${var.project_name}-cleanup-archive-${var.environment}"
  location   = "APAC"
}
