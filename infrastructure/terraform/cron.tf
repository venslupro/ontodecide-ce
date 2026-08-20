# ============================================================
# Cron triggers.
#
# The Cleanup Worker owns the daily 03:00 UTC cron; the schedule is also
# declared in the worker's wrangler.toml `[triggers]` block so the worker
# can run locally with `wrangler dev`. Terraform is the source of truth
# for production.
# ============================================================

resource "cloudflare_worker_cron_trigger" "cleanup" {
  account_id  = local.account_id
  script_name = cloudflare_worker_script.cleanup_service.name
  schedules = [
    "0 3 * * *",     # daily cleanup at 03:00 UTC
  ]
}

# Optional keep-alive cron for Neo4j Aura Free tier (every 6 hours)
# prevents the database from being paused after 72h of inactivity.
resource "cloudflare_worker_cron_trigger" "keepalive" {
  account_id  = local.account_id
  script_name = cloudflare_worker_script.cleanup_service.name
  schedules = [
    "0 */6 * * *",   # keep-alive ping
  ]
}
