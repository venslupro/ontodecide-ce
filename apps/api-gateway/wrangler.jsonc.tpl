// api-gateway: the only entry reachable from the Pages Functions proxy.
// ${...} placeholders are rendered by scripts/gen_wrangler.mjs from
// `terraform output -json`; never hand-write resource ids.
{
  "name": "${PREFIX}-api-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "kv_namespaces": [{"binding": "CONFIG", "id": "${KV_GATEWAY_CONFIG_ID}"}],
  "durable_objects": {"bindings": [{"name": "EDGE_GUARD", "class_name": "EdgeGuard"}]},
  "migrations": [{"tag": "v1", "new_sqlite_classes": ["EdgeGuard"]}],
  "services": [
    {"binding": "IDENTITY", "service": "${PREFIX}-identity-access", "entrypoint": "IdentityRpc"},
    {"binding": "ONTOLOGY", "service": "${PREFIX}-ontology-manager", "entrypoint": "OntologyRpc"},
    {"binding": "INTEGRATION", "service": "${PREFIX}-data-integration", "entrypoint": "IntegrationRpc"},
    {"binding": "OBJECTS", "service": "${PREFIX}-object-graph", "entrypoint": "ObjectGraphRpc"},
    {"binding": "SITUATION", "service": "${PREFIX}-situation-awareness", "entrypoint": "SituationRpc"},
    {"binding": "DECISION", "service": "${PREFIX}-decision-engine", "entrypoint": "DecisionRpc"}
  ],
  "vars": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}",
    "COOKIE_SECURE": "${COOKIE_SECURE}"
  },
  "observability": {"enabled": true}
}
