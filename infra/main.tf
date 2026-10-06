# OntoDecide CE resources (design V2.4, 修订说明书 7.2 / 表 13). Single
# environment: production, applied only from the main branch.
#
#   5 D1 databases, 2 queues (domain-events, dead-letter), 1 B2 bucket
#   (archive) with a write key and two signing-key slots, 1 Turnstile widget,
#   and — when var.domain is set — the account-level pages.dev bulk redirect
#   (domain.tf).
#
# The Pages project ontodecide-ce and its custom domain are created by
# Wrangler in the CD pipeline (apps/web/wrangler.jsonc,
# .github/workflows/deploy.yml), not by Terraform. Workers, their bindings,
# routes, crons and Durable Object migrations also belong to Wrangler
# (apps/*/wrangler.jsonc.tpl). V1.3 resources are released from state in
# legacy.tf and deleted by scripts/cleanup_legacy.sh.
#
# Naming: every resource is named {project}-{env}-{service|module}, e.g.
# ontodecide-prd-object-graph-db (local.prefix). Exceptions: the Pages
# project ontodecide-ce and the state bucket ontodecide-ce-tfstate.

locals {
  prefix = "${var.project}-${var.environment}"

  # Services that own a D1 database (situation-awareness uses its Durable
  # Object storage).
  d1_services = [
    "identity-access",
    "ontology-manager",
    "data-integration",
    "object-graph",
    "decision-engine",
  ]

  pages_host = "ontodecide-ce.pages.dev"
  app_host   = var.domain == "" ? local.pages_host : "ontodecide-ce.${var.domain}"
  app_origin = "https://${local.app_host}"
}

resource "cloudflare_d1_database" "db" {
  for_each   = toset([for s in local.d1_services : "${s}-db"])
  account_id = var.account_id
  name       = "${local.prefix}-${each.key}"
}

# object-graph outbox → situation-awareness (one aggregated message per
# commit, ≤ 64 KB).
resource "cloudflare_queue" "domain_events" {
  account_id = var.account_id
  queue_name = "${local.prefix}-domain-events"
}

# Dead letters of domain-events; no consumer.
resource "cloudflare_queue" "dead_letter" {
  account_id = var.account_id
  queue_name = "${local.prefix}-dead-letter"
}

# Expired-workspace archives (修订说明书 9.4). B2 bucket names are globally
# unique. No CORS: the e-mailed presigned link is a plain navigation, and
# the web app never talks to B2.
resource "b2_bucket" "archive" {
  bucket_name = "${local.prefix}-archive"
  bucket_type = "allPrivate"

  default_server_side_encryption {
    mode      = "SSE-B2"
    algorithm = "AES256"
  }

  # Safety net if the archive saga fails: ZIPs are gone after 9 days at
  # most (links live 7 days).
  lifecycle_rules {
    file_name_prefix              = "archives/"
    days_from_uploading_to_hiding = 8
    days_from_hiding_to_deleting  = 1
  }

  # Export segments staged before zipping.
  lifecycle_rules {
    file_name_prefix              = "staging/"
    days_from_uploading_to_hiding = 1
    days_from_hiding_to_deleting  = 1
  }
}

# identity-access upload / packing / deletion / audit anchor key, bucket
# scoped.
resource "b2_application_key" "archive_write" {
  key_name     = "${local.prefix}-archive-write"
  capabilities = ["deleteFiles", "listFiles", "readFiles", "writeFiles"]
  bucket_ids   = [b2_bucket.archive.bucket_id]
}

# Presigning keys (readFiles on archives/ only), two slots for the monthly
# rotation; var.archive_sign_active selects the one exported to
# identity-access. Links are computed locally (SigV4), never with a B2 call.
resource "b2_application_key" "archive_sign" {
  for_each     = toset(["a", "b"])
  key_name     = "${local.prefix}-archive-sign-${each.key}"
  capabilities = ["readFiles"]
  bucket_ids   = [b2_bucket.archive.bucket_id]
  name_prefix  = "archives/"
}

# Sign-up / login challenge. Local development uses Cloudflare's test keys.
resource "cloudflare_turnstile_widget" "auth" {
  account_id = var.account_id
  name       = "${local.prefix}-auth"
  domains    = [local.app_host]
  mode       = "managed"
}
