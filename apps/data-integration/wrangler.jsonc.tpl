// data-integration: connectors, dataset transactions, mapping, quality.
{
  "name": "data-integration${ENV_SUFFIX}",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "d1_databases": [{
    "binding": "INTEGRATION_DB",
    "database_name": "${D1_INTEGRATION_NAME}",
    "database_id": "${D1_INTEGRATION_ID}",
    "migrations_dir": "../../migrations/integration"
  }],
  "services": [
    {"binding": "ONTOLOGY", "service": "ontology-manager${ENV_SUFFIX}", "entrypoint": "OntologyRpc"}
  ],
  "queues": {
    "producers": [
      {"binding": "INGEST_QUEUE", "queue": "ingest${ENV_SUFFIX}"},
      {"binding": "OBJECT_WRITES_QUEUE", "queue": "object-writes${ENV_SUFFIX}"}
    ],
    "consumers": [{
      "queue": "ingest${ENV_SUFFIX}",
      "max_batch_size": 4,
      "max_retries": 3,
      "dead_letter_queue": "ingest-dlq${ENV_SUFFIX}"
    }]
  },
  "triggers": {"crons": ["*/15 * * * *"]},
  "vars": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "B2_BUCKET": "${B2_RAW_BUCKET}",
    "B2_REGION": "${B2_REGION}",
    "B2_ENDPOINT": "${B2_ENDPOINT}"
  },
  "observability": {"enabled": true}
}
