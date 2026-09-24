// situation-awareness: KPIs, automations and alerts, SituationRoom, UsageGuard.
// Also consumes every *-dlq queue and can replay dead letters.
{
  "name": "situation-awareness${ENV_SUFFIX}",
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
    {"binding": "OBJECTS", "service": "object-graph${ENV_SUFFIX}", "entrypoint": "ObjectGraphRpc"}
  ],
  "queues": {
    "producers": [
      {"binding": "DECISION_JOBS_QUEUE", "queue": "decision-jobs${ENV_SUFFIX}"},
      {"binding": "INGEST_QUEUE", "queue": "ingest${ENV_SUFFIX}"},
      {"binding": "OBJECT_WRITES_QUEUE", "queue": "object-writes${ENV_SUFFIX}"},
      {"binding": "GRAPH_SYNC_QUEUE", "queue": "graph-sync${ENV_SUFFIX}"},
      {"binding": "SITUATION_EVENTS_QUEUE", "queue": "situation-events${ENV_SUFFIX}"}
    ],
    "consumers": [
      {"queue": "situation-events${ENV_SUFFIX}", "max_batch_size": 10, "max_retries": 3,
       "dead_letter_queue": "situation-events-dlq${ENV_SUFFIX}"},
      {"queue": "ingest-dlq${ENV_SUFFIX}", "max_batch_size": 10, "max_retries": 1},
      {"queue": "object-writes-dlq${ENV_SUFFIX}", "max_batch_size": 10, "max_retries": 1},
      {"queue": "graph-sync-dlq${ENV_SUFFIX}", "max_batch_size": 10, "max_retries": 1},
      {"queue": "situation-events-dlq${ENV_SUFFIX}", "max_batch_size": 10, "max_retries": 1},
      {"queue": "decision-jobs-dlq${ENV_SUFFIX}", "max_batch_size": 10, "max_retries": 1}
    ]
  },
  "triggers": {"crons": ["0 * * * *"]},
  "vars": {"ENVIRONMENT": "${ENVIRONMENT}", "USAGE_WARN": "0.8", "USAGE_STOP": "0.95"},
  "observability": {"enabled": true}
}
