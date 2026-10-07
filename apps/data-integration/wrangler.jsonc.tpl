// data-integration: imports (synchronous batches), mapping (deterministic
// + AI draft), sample data. Entry points: IntegrationRpc, TenantLifecycle.
{
  "name": "${PREFIX}-data-integration",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "d1_databases": [{
    "binding": "INTEGRATION_DB",
    "database_name": "${D1_INTEGRATION_NAME}",
    "database_id": "${D1_INTEGRATION_ID}",
    "migrations_dir": "../../migrations/data-integration"
  }],
  "ai": {"binding": "AI"},
  "services": [
    {"binding": "ONTOLOGY", "service": "${PREFIX}-ontology-manager", "entrypoint": "OntologyRpc"},
    {"binding": "OBJECTS", "service": "${PREFIX}-object-graph", "entrypoint": "ObjectGraphRpc"},
    {"binding": "SITUATION", "service": "${PREFIX}-situation-awareness", "entrypoint": "SituationRpc"}
  ],
  "vars": {
    "AI_MODEL": "@cf/qwen/qwen3-30b-a3b-fp8",
    "NEURONS_DAILY_BUDGET": "1500",
    "IMPORT_ROWS_DAILY": "2000",
    "SEED_ROWS_DAILY": "20000",
    "MAPPING_AI_DAILY": "2",
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}"
  },
  "observability": {"enabled": true, "head_sampling_rate": 0.5}
}
