// api-gateway: the only entry reachable from the Pages Functions proxy.
// ${...} placeholders are rendered by scripts/gen_wrangler.mjs from
// `terraform output -json`; never hand-write resource ids.
{
  "name": "api-gateway${ENV_SUFFIX}",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "kv_namespaces": [{"binding": "CONFIG", "id": "${KV_GATEWAY_CONFIG_ID}"}],
  "durable_objects": {"bindings": [{"name": "EDGE_GUARD", "class_name": "EdgeGuard"}]},
  "migrations": [{"tag": "v1", "new_sqlite_classes": ["EdgeGuard"]}],
  "services": [
    {"binding": "IDENTITY", "service": "identity-access${ENV_SUFFIX}", "entrypoint": "IdentityRpc"},
    {"binding": "ONTOLOGY", "service": "ontology-manager${ENV_SUFFIX}", "entrypoint": "OntologyRpc"},
    {"binding": "INTEGRATION", "service": "data-integration${ENV_SUFFIX}", "entrypoint": "IntegrationRpc"},
    {"binding": "OBJECTS", "service": "object-graph${ENV_SUFFIX}", "entrypoint": "ObjectGraphRpc"},
    {"binding": "SITUATION", "service": "situation-awareness${ENV_SUFFIX}", "entrypoint": "SituationRpc"},
    {"binding": "DECISION", "service": "decision-engine${ENV_SUFFIX}", "entrypoint": "DecisionRpc"}
  ],
  "vars": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}",
    "COOKIE_SECURE": "${COOKIE_SECURE}"
  },
  "observability": {"enabled": true}
}
