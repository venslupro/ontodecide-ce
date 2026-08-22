#!/usr/bin/env bash
# Apply D1 migrations to the shared-db (shared by user/ai/cleanup).
#
# The D1 database NAME is constructed to match the Terraform resource:
#   cloudflare_d1_database.shared_db.name
#     = ${PROJECT_NAME}-${ENV_SHORT}-shared-db
# with PROJECT_NAME defaulting to "ontodecide" and ENVIRONMENT defaulting
# to "production" (shortened to "prd" for resource naming).  These defaults
# match the defaults declared in infrastructure/terraform/variables.tf and
# the database_name committed in every wrangler.toml that references the
# shared DB.
#
# If you pass an explicit --env or set PROJECT_NAME via the environment
# you MUST ensure that the same override was passed to the Terraform
# `environment` / `project_name` variables, otherwise migrations will
# hit a non-existent D1.
#
# Usage:
#   ./scripts/migrate.sh                                # local dev, env=production
#   PROJECT_NAME=demo ./scripts/migrate.sh              # override project prefix
#   ./scripts/migrate.sh --remote                       # apply to Cloudflare D1 (env=production)
#   ./scripts/migrate.sh --env staging --remote --ai    # apply to staging DB, and print AI migration banner
#   ./scripts/migrate.sh --help
#   ./scripts/migrate.sh --dry-run                      # print computed values and exit
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: migrate.sh [--remote] [--env ENV] [--ai] [--dry-run] [-h|--help]

  --remote       Apply migrations against the *remote* Cloudflare D1
                 instead of the local preview DB.
  --env ENV      Environment suffix.  Default: "production".  Must match
                 `terraform -var="environment=ENV"` used for the target.
  --ai           After applying User + AI migrations, print a banner
                 confirming the AI migrations also ran (they are always
                 applied; this flag is a visual cue only).
  --dry-run      Print the computed DB_NAME and the commands that would
                 run, without executing them.
  -h, --help     Show this help.

Environment variables:
  PROJECT_NAME   Override the project-name prefix used in the D1 resource
                 name.  Default: "ontodecide".  Must match the Terraform
                 `project_name` variable value used to create the DB.
EOF
}

REMOTE_FLAG=""
APPLY_AI=0
ENVIRONMENT="${ENVIRONMENT:-production}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)  REMOTE_FLAG="--remote"; shift ;;
    --ai)      APPLY_AI=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --env)
      [[ $# -ge 2 ]] || { echo "--env requires a value" >&2; exit 1; }
      ENVIRONMENT="$2"; shift 2 ;;
    --env=*)
      ENVIRONMENT="${1#*=}"; shift ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

PROJECT_NAME="${PROJECT_NAME:-ontodecide}"
# Env short form: production→prd, staging→stg (matches Terraform local.env_short)
ENV_SHORT="$([[ "$ENVIRONMENT" == "production" ]] && echo "prd" || ([[ "$ENVIRONMENT" == "staging" ]] && echo "stg" || echo "$ENVIRONMENT"))"
# Matches exactly: cloudflare_d1_database.shared_db.name
#   = "${var.project_name}-${local.env_short}-shared-db"
DB_NAME="${PROJECT_NAME}-${ENV_SHORT}-shared-db"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  cat <<EOF
==> Migrate: --dry-run
PROJECT_NAME = ${PROJECT_NAME}
ENVIRONMENT  = ${ENVIRONMENT}
DB_NAME      = ${DB_NAME}
REMOTE?      = ${REMOTE_FLAG:--none-}
Commands to run:
  pnpm --filter=@ontodecide/user exec wrangler d1 migrations apply ${DB_NAME} ${REMOTE_FLAG}
  pnpm --filter=@ontodecide/ai   exec wrangler d1 migrations apply ${DB_NAME} ${REMOTE_FLAG}
EOF
  exit 0
fi

echo "==> Applying User Service migrations to D1 database: ${DB_NAME} ${REMOTE_FLAG}"
pnpm --filter=@ontodecide/user exec wrangler d1 migrations apply "${DB_NAME}" ${REMOTE_FLAG}

echo "==> Applying AI Service migrations to D1 database: ${DB_NAME} ${REMOTE_FLAG}"
pnpm --filter=@ontodecide/ai exec wrangler d1 migrations apply "${DB_NAME}" ${REMOTE_FLAG}

if [[ ${APPLY_AI} -eq 1 ]]; then
  echo "==> AI migrations explicitly applied (printed confirmation)."
fi

echo "==> Done. Remember to seed the bootstrap admin password:"
echo "    UPDATE users SET password_hash = '<pbkdf2 hash>' WHERE username = 'admin';"
