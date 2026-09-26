// situation-awareness: KPIs, automations and alerts, SituationRoom, UsageGuard.
// Also consumes every *-dlq queue and can replay dead letters.
{
  "name": "situation-awareness",
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
    {"binding": "OBJECTS", "service": "object-graph", "entrypoint": "ObjectGraphRpc"}
  ],
  "queues": {
    "producers": [
      {"binding": "DECISION_JOBS_QUEUE", "queue": "decision-jobs"},
      {"binding": "INGEST_QUEUE", "queue": "ingest"},
      {"binding": "OBJECT_WRITES_QUEUE", "queue": "object-writes"},
      {"binding": "GRAPH_SYNC_QUEUE", "queue": "graph-sync"},
      {"binding": "SITUATION_EVENTS_QUEUE", "queue": "situation-events"}
    ],
    "consumers": [
      {"queue": "situation-events", "max_batch_size": 10, "max_retries": 3,
       "dead_letter_queue": "situation-events-dlq"},
      {"queue": "ingest-dlq", "max_batch_size": 10, "max_retries": 1},
      {"queue": "object-writes-dlq", "max_batch_size": 10, "max_retries": 1},
      {"queue": "graph-sync-dlq", "max_batch_size": 10, "max_retries": 1},
      {"queue": "situation-events-dlq", "max_batch_size": 10, "max_retries": 1},
      {"queue": "decision-jobs-dlq", "max_batch_size": 10, "max_retries": 1}
    ]
  },
  "triggers": {"crons": ["0 * * * *"]},
  "vars": {"ENVIRONMENT": "${ENVIRONMENT}", "USAGE_WARN": "0.8", "USAGE_STOP": "0.95"},
  "observability": {"enabled": true}
}
