// object-graph: authoritative objects and links, actions, lineage, outbox.
// Entry points: ObjectGraphRpc, TenantLifecycle. Produces one aggregated
// domain-events message per commit; the */15 cron redelivers the outbox.
{
  "name": "${PREFIX}-object-graph",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "d1_databases": [{
    "binding": "OBJECT_DB",
    "database_name": "${D1_OBJECT_NAME}",
    "database_id": "${D1_OBJECT_ID}",
    "migrations_dir": "../../migrations/object-graph"
  }],
  "services": [
    {"binding": "ONTOLOGY", "service": "${PREFIX}-ontology-manager", "entrypoint": "OntologyRpc"}
  ],
  "queues": {
    "producers": [{"binding": "DOMAIN_EVENTS", "queue": "${QUEUE_DOMAIN_EVENTS}"}]
  },
  "triggers": {"crons": ["*/15 * * * *"]},
  "vars": {
    "MAX_OBJECTS": "300",
    "MAX_LINKS": "900",
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}"
  },
  "observability": {"enabled": true, "head_sampling_rate": 0.5}
}
