# ============================================================
# D1 database: decision-db (shared by User, AI, Cleanup services).
# ============================================================

resource "cloudflare_d1_database" "decision_db" {
  account_id = local.account_id
  name       = "${var.project_name}-decision-db-${var.environment}"
}

# Apply the schema migrations. Wrangler-managed migrations are idempotent
# so this resource is safe to re-run; the script `scripts/migrate.sh` is the
# authoritative path for production.
resource "cloudflare_d1_database" "decision_db_seed" {
  count      = var.environment == "production" ? 0 : 0 # placeholder
  account_id = local.account_id
  name       = "${var.project_name}-decision-db-seed-${var.environment}"
}
