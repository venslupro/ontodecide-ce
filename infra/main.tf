# OntoDecide CE resources (design V1.3, 总体设计 4.2.4). Single environment:
# production, applied only from the main branch.
#
# 6 D1 databases (one per business service), 2 KV namespaces, 5 queues +
# 5 DLQs, B2 raw bucket + scoped key, Neo4j AuraDB Free.
#
# Not managed here (no provider): Vectorize index (scripts/bootstrap.sh).
#
# Naming: every resource is named {project}-{env}-{service|module}, e.g.
# ontodecide-prd-api-gateway, ontodecide-prd-graphdb (local.prefix).

locals {
  prefix     = "${var.project}-${var.environment}"
  services   = ["identity-access", "ontology-manager", "data-integration", "object-graph", "situation-awareness", "decision-engine"]
  queue_base = ["ingest", "object-writes", "graph-sync", "situation-events", "decision-jobs"]
  queues     = flatten([for q in local.queue_base : [q, "${q}-dlq"]])
}

resource "cloudflare_d1_database" "db" {
  for_each   = toset([for s in local.services : "${s}-db"])
  account_id = var.account_id
  name       = "${local.prefix}-${each.key}"
}

resource "cloudflare_workers_kv_namespace" "schema_cache" {
  account_id = var.account_id
  title      = "${local.prefix}-schema-cache"
}

resource "cloudflare_workers_kv_namespace" "gateway_config" {
  account_id = var.account_id
  title      = "${local.prefix}-gateway-config"
}

resource "cloudflare_queue" "q" {
  for_each   = toset(local.queues)
  account_id = var.account_id
  queue_name = "${local.prefix}-${each.key}"
}

# Raw files, snapshots and backups (B2 bucket names are globally unique).
resource "b2_bucket" "raw" {
  bucket_name = "${local.prefix}-raw"
  bucket_type = "allPrivate"

  default_server_side_encryption {
    mode      = "SSE-B2"
    algorithm = "AES256"
  }

  cors_rules {
    cors_rule_name  = "browser-direct-upload"
    allowed_origins = ["https://ontodecide-ce.pages.dev", "https://*.ontodecide-ce.pages.dev"]
    allowed_operations = [
      "s3_put",
    ]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }

  # Raw uploads are kept 30 days.
  lifecycle_rules {
    file_name_prefix              = "raw/"
    days_from_uploading_to_hiding = 30
    days_from_hiding_to_deleting  = 1
  }
}

# Least-privilege key for data-integration (presigned uploads only).
resource "b2_application_key" "integration" {
  key_name     = "${local.prefix}-data-integration"
  capabilities = ["listFiles", "readFiles", "writeFiles"]
  bucket_ids   = [b2_bucket.raw.bucket_id]
}

data "neo4jaura_projects" "this" {
  count = var.enable_neo4j ? 1 : 0
}

resource "neo4jaura_instance" "graph" {
  count          = var.enable_neo4j ? 1 : 0
  name           = "${local.prefix}-graphdb"
  cloud_provider = var.neo4j_cloud_provider
  region         = var.neo4j_region
  type           = "free-db"
  version        = "5"
  project_id     = data.neo4jaura_projects.this[0].projects[0].id

  lifecycle {
    prevent_destroy = true
  }
}
