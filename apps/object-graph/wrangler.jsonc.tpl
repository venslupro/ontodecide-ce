// object-graph: authoritative objects and links, actions, lineage, Neo4j projection.
{
  "name": "object-graph${ENV_SUFFIX}",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "d1_databases": [{
    "binding": "OBJECT_DB",
    "database_name": "${D1_OBJECT_NAME}",
    "database_id": "${D1_OBJECT_ID}",
    "migrations_dir": "../../migrations/object"
  }],
  "services": [
    {"binding": "ONTOLOGY", "service": "ontology-manager${ENV_SUFFIX}", "entrypoint": "OntologyRpc"},
    {"binding": "INTEGRATION", "service": "data-integration${ENV_SUFFIX}", "entrypoint": "IntegrationRpc"}
  ],
  "queues": {
    "producers": [
      {"binding": "GRAPH_SYNC_QUEUE", "queue": "graph-sync${ENV_SUFFIX}"},
      {"binding": "SITUATION_EVENTS_QUEUE", "queue": "situation-events${ENV_SUFFIX}"}
    ],
    "consumers": [
      {"queue": "object-writes${ENV_SUFFIX}", "max_batch_size": 4, "max_retries": 3,
       "dead_letter_queue": "object-writes-dlq${ENV_SUFFIX}"},
      {"queue": "graph-sync${ENV_SUFFIX}", "max_batch_size": 10, "max_retries": 5,
       "dead_letter_queue": "graph-sync-dlq${ENV_SUFFIX}"}
    ]
  },
  "triggers": {"crons": ["*/15 * * * *"]},
  "vars": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "FEATURE_NEO4J": "${FEATURE_NEO4J}",
    "NEO4J_DATABASE": "neo4j"
  },
  "observability": {"enabled": true}
}
