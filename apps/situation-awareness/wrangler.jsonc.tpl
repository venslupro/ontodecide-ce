// situation-awareness: KPIs, automations, alerts and the per-workspace
// SituationRoom Durable Object (WebSocket, DO alarm for scheduled rules).
// Entry points: SituationRpc (+ fetch for WebSocket), TenantLifecycle.
// Consumes domain-events. DO migration v2 deletes the V1.3 UsageGuard class.
{
  "name": "${PREFIX}-situation-awareness",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "durable_objects": {"bindings": [
    {"name": "SITUATION_ROOM", "class_name": "SituationRoom"}
  ]},
  "migrations": [
    {"tag": "v1", "new_sqlite_classes": ["SituationRoom", "UsageGuard"]},
    {"tag": "v2", "deleted_classes": ["UsageGuard"]}
  ],
  "services": [
    {"binding": "OBJECTS", "service": "${PREFIX}-object-graph", "entrypoint": "ObjectGraphRpc"},
    {"binding": "ONTOLOGY", "service": "${PREFIX}-ontology-manager", "entrypoint": "OntologyRpc"}
  ],
  "queues": {
    "consumers": [{
      "queue": "${QUEUE_DOMAIN_EVENTS}",
      "max_batch_size": 10,
      "max_retries": 3,
      "dead_letter_queue": "${QUEUE_DEAD_LETTER}"
    }]
  },
  "vars": {
    "APP_ORIGIN": "${APP_ORIGIN}",
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}"
  },
  "observability": {"enabled": true, "head_sampling_rate": 0.5}
}
