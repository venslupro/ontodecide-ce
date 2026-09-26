// decision-engine: simulation, AI recommendations, approval, outcome evaluation, LLM gateway.
{
  "name": "${PREFIX}-decision-engine",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "d1_databases": [{
    "binding": "DECISION_DB",
    "database_name": "${D1_DECISION_NAME}",
    "database_id": "${D1_DECISION_ID}",
    "migrations_dir": "../../migrations/decision"
  }],
  "ai": {"binding": "AI"},
  "vectorize": [{"binding": "VEC", "index_name": "${PREFIX}-decision-cases-bge-m3"}],
  "services": [
    {"binding": "OBJECTS", "service": "${PREFIX}-object-graph", "entrypoint": "ObjectGraphRpc"},
    {"binding": "SITUATION", "service": "${PREFIX}-situation-awareness", "entrypoint": "SituationRpc"},
    {"binding": "ONTOLOGY", "service": "${PREFIX}-ontology-manager", "entrypoint": "OntologyRpc"}
  ],
  "queues": {
    "producers": [{"binding": "DECISION_JOBS_QUEUE", "queue": "${PREFIX}-decision-jobs"}],
    "consumers": [{
      "queue": "${PREFIX}-decision-jobs",
      "max_batch_size": 5,
      "max_retries": 3,
      "dead_letter_queue": "${PREFIX}-decision-jobs-dlq"
    }]
  },
  "triggers": {"crons": ["0 1 * * *"]},
  "vars": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "LLM_CHAIN": "workers-ai,gemini,groq",
    "LLM_TENANT_DAILY_LIMIT": "50",
    "LLM_USER_DAILY_LIMIT": "20",
    "REC_EXPIRE_HOURS": "24"
  },
  "observability": {"enabled": true}
}
