// identity-access: accounts, roles, markings, token issuance.
{
  "name": "identity-access${ENV_SUFFIX}",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "d1_databases": [{
    "binding": "IDENTITY_DB",
    "database_name": "${D1_IDENTITY_NAME}",
    "database_id": "${D1_IDENTITY_ID}",
    "migrations_dir": "../../migrations/identity"
  }],
  "vars": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "BOOTSTRAP_ADMIN_EMAIL": "${BOOTSTRAP_ADMIN_EMAIL}",
    "BOOTSTRAP_TENANT_NAME": "OntoDecide"
  },
  "observability": {"enabled": true}
}
