// decision-engine: scenarios (deterministic propagation), AI-ranked
// recommendations with rule fallback, decisions. Entry points: DecisionRpc,
// TenantLifecycle.
{
  "name": "${PREFIX}-decision-engine",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "d1_databases": [{
    "binding": "DECISION_DB",
    "database_name": "${D1_DECISION_NAME}",
    "database_id": "${D1_DECISION_ID}",
    "migrations_dir": "../../migrations/decision-engine"
  }],
  "ai": {"binding": "AI"},
  "services": [
    {"binding": "OBJECTS", "service": "${PREFIX}-object-graph", "entrypoint": "ObjectGraphRpc"},
    {"binding": "SITUATION", "service": "${PREFIX}-situation-awareness", "entrypoint": "SituationRpc"},
    {"binding": "ONTOLOGY", "service": "${PREFIX}-ontology-manager", "entrypoint": "OntologyRpc"}
  ],
  "vars": {
    "AI_MODEL": "@cf/qwen/qwen3-30b-a3b-fp8",
    "AI_FALLBACK_MODEL": "@cf/openai/gpt-oss-20b",
    "REC_AI_USER_DAILY_LIMIT": "3",
    "NEURONS_DAILY_BUDGET": "6500",
    "NEURONS_RESERVE_FACTOR": "1.3",
    "REC_EXPIRE_HOURS": "24",
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}"
  },
  "observability": {"enabled": true, "head_sampling_rate": 0.5}
}
