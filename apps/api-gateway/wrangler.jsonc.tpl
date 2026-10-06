// api-gateway: the only public entry, reached through the Pages Functions
// proxy (functions/api/[[path]].ts via the GATEWAY service binding). The
// apex DNS stays with its registrar (no Cloudflare zone), so there is no
// Workers Route; `routes` is always removed by gen_wrangler.mjs. Binds the
// business entry points of the six services (never TenantLifecycle).
// DO migration v2 deletes the V1.3 EdgeGuard class; no DO bindings remain.
{
  "name": "${PREFIX}-api-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{"pattern": "${APP_HOST}/api/*", "zone_name": "${ZONE_NAME}"}],
  "migrations": [
    {"tag": "v1", "new_sqlite_classes": ["EdgeGuard"]},
    {"tag": "v2", "deleted_classes": ["EdgeGuard"]}
  ],
  "services": [
    {"binding": "IDENTITY", "service": "${PREFIX}-identity-access", "entrypoint": "IdentityRpc"},
    {"binding": "ONTOLOGY", "service": "${PREFIX}-ontology-manager", "entrypoint": "OntologyRpc"},
    {"binding": "INTEGRATION", "service": "${PREFIX}-data-integration", "entrypoint": "IntegrationRpc"},
    {"binding": "OBJECTS", "service": "${PREFIX}-object-graph", "entrypoint": "ObjectGraphRpc"},
    {"binding": "SITUATION", "service": "${PREFIX}-situation-awareness", "entrypoint": "SituationRpc"},
    {"binding": "DECISION", "service": "${PREFIX}-decision-engine", "entrypoint": "DecisionRpc"}
  ],
  "ratelimits": [
    {"name": "RL_USER_READ", "namespace_id": "1001", "simple": {"limit": 120, "period": 60}},
    {"name": "RL_USER_WRITE", "namespace_id": "1002", "simple": {"limit": 30, "period": 60}},
    {"name": "RL_EMAIL", "namespace_id": "1003", "simple": {"limit": 5, "period": 60}},
    {"name": "RL_IP_AUTH", "namespace_id": "1004", "simple": {"limit": 10, "period": 60}}
  ],
  "vars": {
    "APP_ORIGIN": "${APP_ORIGIN}",
    "JWT_PUBLIC_KEYS": "${JWT_PUBLIC_KEYS}",
    "MAX_BODY_BYTES": "524288",
    "ACT_AS_CACHE_S": "60",
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}"
  },
  "observability": {"enabled": true, "head_sampling_rate": 0.5}
}
