// situation-awareness: KPIs, automations and alerts, SituationRoom, UsageGuard.
// Also consumes every *-dlq queue and can replay dead letters.
{
  "name": "${PREFIX}-situation-awareness",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "d1_databases": [{
    "binding": "SITUATION_DB",
    "database_name": "${D1_SITUATION_NAME}",
    "database_id": "${D1_SITUATION_ID}",
    "migrations_dir": "../../migrations/situation"
  }],
  "durable_objects": {"bindings": [
    {"name": "SITUATION_ROOM", "class_name": "SituationRoom"},
    {"name": "USAGE_GUARD", "class_name": "UsageGuard"}
  ]},
  "migrations": [{"tag": "v1", "new_sqlite_classes": ["SituationRoom", "UsageGuard"]}],
  "services": [
    {"binding": "OBJECTS", "service": "${PREFIX}-object-graph", "entrypoint": "ObjectGraphRpc"}
  ],
  "queues": {
    "producers": [
      {"binding": "DECISION_JOBS_QUEUE", "queue": "${PREFIX}-decision-jobs"},
      {"binding": "INGEST_QUEUE", "queue": "${PREFIX}-ingest"},
      {"binding": "OBJECT_WRITES_QUEUE", "queue": "${PREFIX}-object-writes"},
      {"binding": "GRAPH_SYNC_QUEUE", "queue": "${PREFIX}-graph-sync"},
      {"binding": "SITUATION_EVENTS_QUEUE", "queue": "${PREFIX}-situation-events"}
    ],
    "consumers": [
      {"queue": "${PREFIX}-situation-events", "max_batch_size": 10, "max_retries": 3,
       "dead_letter_queue": "${PREFIX}-situation-events-dlq"},
      {"queue": "${PREFIX}-ingest-dlq", "max_batch_size": 10, "max_retries": 1},
      {"queue": "${PREFIX}-object-writes-dlq", "max_batch_size": 10, "max_retries": 1},
      {"queue": "${PREFIX}-graph-sync-dlq", "max_batch_size": 10, "max_retries": 1},
      {"queue": "${PREFIX}-situation-events-dlq", "max_batch_size": 10, "max_retries": 1},
      {"queue": "${PREFIX}-decision-jobs-dlq", "max_batch_size": 10, "max_retries": 1}
    ]
  },
  "triggers": {"crons": ["0 * * * *"]},
  "vars": {"ENVIRONMENT": "${ENVIRONMENT}", "USAGE_WARN": "0.8", "USAGE_STOP": "0.95"},
  "observability": {"enabled": true}
}
