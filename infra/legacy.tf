# V1.3 resources that V2.4 no longer uses. They are released from the
# Terraform state without being destroyed (`destroy = false`), because the
# V1.3 Workers still bind to them until the V2.4 rollout has replaced every
# Worker. Delete them afterwards with scripts/cleanup_legacy.sh (manual,
# idempotent), then drop these blocks in a later change.
#
# On a fresh state (new account) every block below is a no-op.

# situation-awareness-db: SituationRoom Durable Object storage replaces it.
# `removed` cannot address one for_each instance, so move it out first.
moved {
  from = cloudflare_d1_database.db["situation-awareness-db"]
  to   = cloudflare_d1_database.legacy_situation
}

removed {
  from = cloudflare_d1_database.legacy_situation
  lifecycle {
    destroy = false
  }
}

# KV: schema cache and gateway config.
removed {
  from = cloudflare_workers_kv_namespace.schema_cache
  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_workers_kv_namespace.gateway_config
  lifecycle {
    destroy = false
  }
}

# Five queues and their five dead-letter queues.
removed {
  from = cloudflare_queue.q
  lifecycle {
    destroy = false
  }
}

# Raw upload bucket and the data-integration key.
removed {
  from = b2_bucket.raw
  lifecycle {
    destroy = false
  }
}

removed {
  from = b2_application_key.integration
  lifecycle {
    destroy = false
  }
}

# Neo4j AuraDB Free instance. The neo4jaura provider stays in versions.tf
# (and AURA_* in terraform.yml) until this block is gone, so Terraform can
# still read the state entry it forgets.
removed {
  from = neo4jaura_instance.graph
  lifecycle {
    destroy = false
  }
}
