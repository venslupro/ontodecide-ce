// ontology-manager: ontology templates, copy-on-write workspace ontologies,
// publishing and compilation. Entry points: OntologyRpc, TenantLifecycle.
// ${...} placeholders are rendered by scripts/gen_wrangler.mjs from
// `terraform output -json`; never hand-write resource ids.
{
  "name": "${PREFIX}-ontology-manager",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "d1_databases": [{
    "binding": "ONTOLOGY_DB",
    "database_name": "${D1_ONTOLOGY_NAME}",
    "database_id": "${D1_ONTOLOGY_ID}",
    "migrations_dir": "../../migrations/ontology-manager"
  }],
  "vars": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}"
  },
  "observability": {"enabled": true, "head_sampling_rate": 0.5}
}
