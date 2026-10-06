# Consumed by scripts/gen_wrangler.mjs and .github/actions/deploy-worker
# (`terraform output -json`). Ids and names are not secret; the B2 keys and
# the Turnstile secret are sensitive and only become Worker secrets.

output "name_prefix" {
  description = "{project}-{env} prefix of every resource name."
  value       = local.prefix
}

output "d1" {
  description = "D1 databases keyed by <service>-db: {id, name}."
  value       = { for k, v in cloudflare_d1_database.db : k => { id = v.id, name = v.name } }
}

output "queues" {
  description = "Queue names."
  value = {
    domain_events = cloudflare_queue.domain_events.queue_name
    dead_letter   = cloudflare_queue.dead_letter.queue_name
  }
}

output "b2" {
  description = "Archive bucket and its S3 endpoint."
  value = {
    bucket   = b2_bucket.archive.bucket_name
    region   = var.b2_region
    endpoint = "s3.${var.b2_region}.backblazeb2.com"
  }
}

output "b2_archive_keys" {
  description = "identity-access archive keys: write key and the active signing key."
  value = {
    write_key_id = b2_application_key.archive_write.application_key_id
    write_key    = b2_application_key.archive_write.application_key
    sign_slot    = var.archive_sign_active
    sign_key_id  = b2_application_key.archive_sign[var.archive_sign_active].application_key_id
    sign_key     = b2_application_key.archive_sign[var.archive_sign_active].application_key
  }
  sensitive = true
}

output "turnstile" {
  description = "Turnstile widget (public site key for the web build)."
  value = {
    sitekey = cloudflare_turnstile_widget.auth.sitekey
  }
}

output "turnstile_secret" {
  description = "Turnstile secret for identity-access siteverify."
  value       = cloudflare_turnstile_widget.auth.secret
  sensitive   = true
}

output "app" {
  description = "Public app location: domain (empty without one), host and origin."
  value = {
    domain = var.domain
    host   = local.app_host
    origin = local.app_origin
  }
}

output "zone" {
  description = "Cloudflare zone: id and name (created if absent, imported by CI, never destroyed)."
  value = var.domain == "" ? null : {
    id   = cloudflare_zone.main[0].id
    name = cloudflare_zone.main[0].name
  }
}
