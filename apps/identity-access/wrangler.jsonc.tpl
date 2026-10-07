// identity-access: e-mail code sign-up and login, trial workspaces, the
// bootstrap Admin (passkeys), token issuance (Ed25519), archive saga to B2
// and deletion. Entry point: IdentityRpc. Binds only the TenantLifecycle
// entry points of the five other services (no business RPC).
// The */2 cron advances one lifecycle step per run.
// Secrets (wrangler secret bulk): JWT_SIGNING_KEY, EMAIL_PEPPER,
// EMAIL_ENC_KEY, RESEND_API_KEY, TURNSTILE_SECRET,
// B2_WRITE_KEY_ID, B2_WRITE_APP_KEY, B2_SIGN_KEY_ID, B2_SIGN_APP_KEY,
// CF_ANALYTICS_TOKEN, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_SETUP_CODE.
{
  "name": "${PREFIX}-identity-access",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "d1_databases": [{
    "binding": "IDENTITY_DB",
    "database_name": "${D1_IDENTITY_NAME}",
    "database_id": "${D1_IDENTITY_ID}",
    "migrations_dir": "../../migrations/identity-access"
  }],
  "services": [
    {"binding": "LC_ONTOLOGY", "service": "${PREFIX}-ontology-manager", "entrypoint": "TenantLifecycle"},
    {"binding": "LC_INTEGRATION", "service": "${PREFIX}-data-integration", "entrypoint": "TenantLifecycle"},
    {"binding": "LC_OBJECTS", "service": "${PREFIX}-object-graph", "entrypoint": "TenantLifecycle"},
    {"binding": "LC_SITUATION", "service": "${PREFIX}-situation-awareness", "entrypoint": "TenantLifecycle"},
    {"binding": "LC_DECISION", "service": "${PREFIX}-decision-engine", "entrypoint": "TenantLifecycle"}
  ],
  "triggers": {"crons": ["*/2 * * * *"]},
  "vars": {
    "APP_ORIGIN": "${APP_ORIGIN}",
    "MAIL_FROM": "${MAIL_FROM}",
    "EMAIL_MODE": "${EMAIL_MODE}",
    "TRIAL_HOURS": "72",
    "ARCHIVE_DAYS": "7",
    "ARCHIVE_DELAY_MIN": "16",
    "PURGE_BACKLOG_LIMIT": "10",
    "PURGE_ROWS_DAILY": "30000",
    "MAX_SESSIONS": "3",
    "ADMIN_SESSION_HOURS": "8",
    "RESEND_DAILY_CAP": "90",
    "RESEND_MONTHLY_CAP": "2900",
    "B2_ARCHIVE_BUCKET": "${B2_ARCHIVE_BUCKET}",
    "B2_ENDPOINT": "${B2_ENDPOINT}",
    "B2_REGION": "${B2_REGION}",
    "ARCHIVE_LINK_TTL_S": "604800",
    "WEBAUTHN_RP_ID": "${WEBAUTHN_RP_ID}",
    "WEBAUTHN_RP_NAME": "OntoDecide CE",
    "CF_ACCOUNT_ID": "${CF_ACCOUNT_ID}",
    "ENVIRONMENT": "${ENVIRONMENT}",
    "APP_VERSION": "${APP_VERSION}"
  },
  "observability": {"enabled": true, "head_sampling_rate": 0.5}
}
