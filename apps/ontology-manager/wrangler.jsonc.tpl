// ontology-manager: schema drafts, publishing, compilation, packs.
{
  "name": "${PREFIX}-ontology-manager",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "d1_databases": [{
    "binding": "ONTOLOGY_DB",
    "database_name": "${D1_ONTOLOGY_NAME}",
    "database_id": "${D1_ONTOLOGY_ID}",
    "migrations_dir": "../../migrations/ontology"
  }],
  "kv_namespaces": [{"binding": "SCHEMA_CACHE", "id": "${KV_SCHEMA_CACHE_ID}"}],
  "vars": {"ENVIRONMENT": "${ENVIRONMENT}"},
  "observability": {"enabled": true}
}
