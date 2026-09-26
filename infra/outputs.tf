# Consumed by scripts/gen_wrangler.mjs (`terraform output -json`). IDs are
# not secret; the B2 key and Neo4j password are sensitive and are only read
# by the deploy workflow to upload Worker secrets.

output "name_prefix" {
  description = "{project}-{env} prefix of every resource name."
  value       = local.prefix
}

output "d1" {
  description = "D1 databases keyed by <service>-db: {id, name}."
  value       = { for k, v in cloudflare_d1_database.db : k => { id = v.id, name = v.name } }
}

output "kv" {
  description = "KV namespace ids."
  value = {
    schema_cache   = cloudflare_workers_kv_namespace.schema_cache.id
    gateway_config = cloudflare_workers_kv_namespace.gateway_config.id
  }
}

output "queues" {
  value = sort([for q in cloudflare_queue.q : q.queue_name])
}

output "b2" {
  value = {
    bucket   = b2_bucket.raw.bucket_name
    region   = var.b2_region
    endpoint = "s3.${var.b2_region}.backblazeb2.com"
  }
}

output "b2_integration_key" {
  value = {
    key_id = b2_application_key.integration.application_key_id
    key    = b2_application_key.integration.application_key
  }
  sensitive = true
}

output "neo4j" {
  description = "Neo4j connection (null when disabled)."
  value = length(neo4jaura_instance.graph) == 0 ? null : {
    url      = neo4jaura_instance.graph[0].connection_url
    username = neo4jaura_instance.graph[0].username
  }
}

output "neo4j_password" {
  value     = length(neo4jaura_instance.graph) == 0 ? null : neo4jaura_instance.graph[0].password
  sensitive = true
}
