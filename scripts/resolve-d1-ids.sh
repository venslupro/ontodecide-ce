#!/usr/bin/env bash
# ============================================================================
# resolve-d1-ids.sh — Bridge Terraform-managed D1 databases → wrangler.toml
#
# Problem:
#   The service wrangler.toml files declare [[d1_databases]] with
#   `database_name` (the Terraform-computed name like ontodecide-prd-shared-db)
#   but Wrangler v3.110+ (and v4) require a `database_id` UUID binding.
#   The real database IDs are deliberately NOT committed to git (they are
#   account-scoped UUIDs; see infrastructure/terraform/outputs.tf — only the
#   NAME is exported, never the ID).  So `wrangler secret bulk` / `deploy`
#   fails with:
#     "d1_databases[0]" bindings must have a "database_id" field
#
# Solution:
#   This script fetches all D1 databases under the Cloudflare account via the
#   REST API, builds a name → UUID map, and for every [[d1_databases]] block
#   in the target wrangler.toml that uses `database_name` (with or without a
#   placeholder / real `database_id`), it inserts/replaces `database_id`
#   with the UUID matched on the computed database name.
#
#   Database name convention (MUST match infrastructure/terraform/main.tf):
#     cloudflare_d1_database.*.name = "${project_name}-${env_short}-shared-db"
#
# Usage:
#   ./scripts/resolve-d1-ids.sh <service-dir>
#   e.g. ./scripts/resolve-d1-ids.sh apps/api/user
#
# Env vars (required):
#   CF_ACCOUNT_ID  — Cloudflare account ID (32 hex)
#   CF_API_TOKEN   — Cloudflare API token (D1 read scope: Account.D1: Read)
#
# Env vars (optional):
#   PROJECT_NAME   — defaults to "ontodecide"
#   ENVIRONMENT    — defaults to "production" (-> env_short "prd")
# ============================================================================
set -euo pipefail

SERVICE_DIR="${1:?usage: resolve-d1-ids.sh <service-dir>}"
WRANGLER_TOML="${SERVICE_DIR}/wrangler.toml"

if [[ ! -f "${WRANGLER_TOML}" ]]; then
  echo "ERROR: wrangler.toml not found: ${WRANGLER_TOML}" >&2
  exit 1
fi

: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID must be set}"
: "${CF_API_TOKEN:?CF_API_TOKEN must be set}"

PROJECT_NAME="${PROJECT_NAME:-ontodecide}"
ENVIRONMENT="${ENVIRONMENT:-production}"

case "${ENVIRONMENT}" in
  production) ENV_SHORT="prd" ;;
  staging)    ENV_SHORT="stg" ;;
  *)          ENV_SHORT="${ENVIRONMENT}" ;;
esac

RES_PREFIX="${PROJECT_NAME}-${ENV_SHORT}"
SVC="$(basename "${SERVICE_DIR}")"

# ---- Fetch all D1 databases (single page covers <=100 DBs per account) ----
echo "-> Fetching D1 databases from Cloudflare (prefix=${RES_PREFIX}, svc=${SVC})"
D1_JSON="$(curl -sfS \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database?per_page=100")"

API_SUCCESS="$(echo "${D1_JSON}" | jq -r '.success')"
if [[ "${API_SUCCESS}" != "true" ]]; then
  echo "ERROR: Cloudflare API returned failure:" >&2
  echo "${D1_JSON}" | jq '.errors' >&2
  echo "  Ensure CF_API_TOKEN has Account.D1: Read scope." >&2
  exit 1
fi

# ---- Build name -> uuid associative array --------------------------------
declare -A D1_MAP
while IFS=$'\t' read -r name uuid; do
  [[ -n "${name}" ]] && D1_MAP["${name}"]="${uuid}"
done < <(echo "${D1_JSON}" | jq -r '.result[] | [.name, .uuid] | @tsv')

# ---- Patch wrangler.toml in place ----------------------------------------
TMP_FILE="$(mktemp)"
IN_D1_BLOCK=0
CURRENT_DB_NAME=""
HAS_DATABASE_ID_LINE=0
PLACEHOLDER_COUNT=0
RESOLVED_COUNT=0

flush_current_d1_database_id() {
  if [[ -n "${CURRENT_DB_NAME}" ]]; then
    PLACEHOLDER_COUNT=$((PLACEHOLDER_COUNT + 1))
    REAL_ID="${D1_MAP[${CURRENT_DB_NAME}]:-}"
    if [[ -z "${REAL_ID}" ]]; then
      echo "ERROR: D1 database not found for name: ${CURRENT_DB_NAME}" >&2
      echo "  Ensure Terraform has been applied (infrastructure/terraform/) to create the D1 database." >&2
      exit 1
    fi
    echo "  OK: ${SVC}/DB -> ${CURRENT_DB_NAME} = ${REAL_ID}" >&2
    printf 'database_id = "%s"\n' "${REAL_ID}"
    RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
  fi
}

while IFS= read -r line; do
  # Detect start of a [[d1_databases]] block
  if [[ "${line}" =~ ^\[\[d1_databases\]\] ]]; then
    if [[ ${IN_D1_BLOCK} -eq 1 && ${HAS_DATABASE_ID_LINE} -eq 0 ]]; then
      flush_current_d1_database_id
    fi
    IN_D1_BLOCK=1
    CURRENT_DB_NAME=""
    HAS_DATABASE_ID_LINE=0
    printf '%s\n' "${line}"
    continue
  fi

  if [[ ${IN_D1_BLOCK} -eq 1 ]]; then
    # Track database_name = "..."
    if [[ "${line}" =~ ^database_name[[:space:]]*=[[:space:]]*\"([^\"]+)\" ]]; then
      CURRENT_DB_NAME="${BASH_REMATCH[1]}"
      printf '%s\n' "${line}"
      continue
    fi

    # Replace existing database_id = "..." lines
    if [[ "${line}" =~ ^database_id[[:space:]]*=[[:space:]]*\" ]]; then
      HAS_DATABASE_ID_LINE=1
      if [[ -n "${CURRENT_DB_NAME}" ]]; then
        PLACEHOLDER_COUNT=$((PLACEHOLDER_COUNT + 1))
        REAL_ID="${D1_MAP[${CURRENT_DB_NAME}]:-}"
        if [[ -z "${REAL_ID}" ]]; then
          echo "ERROR: D1 database not found for name: ${CURRENT_DB_NAME}" >&2
          echo "  Ensure Terraform has been applied." >&2
          exit 1
        fi
        echo "  OK: ${SVC}/DB -> ${CURRENT_DB_NAME} = ${REAL_ID}" >&2
        printf 'database_id = "%s"\n' "${REAL_ID}"
        RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
      else
        printf '%s\n' "${line}"
      fi
      continue
    fi

    # Detect end of [[d1_databases]] block: next top-level [section]
    if [[ "${line}" =~ ^\[ ]]; then
      if [[ ${HAS_DATABASE_ID_LINE} -eq 0 && -n "${CURRENT_DB_NAME}" ]]; then
        flush_current_d1_database_id
      fi
      IN_D1_BLOCK=0
      CURRENT_DB_NAME=""
      HAS_DATABASE_ID_LINE=0
      printf '%s\n' "${line}"
      continue
    fi
  fi

  printf '%s\n' "${line}"
done < "${WRANGLER_TOML}" > "${TMP_FILE}"

# After file ends, flush last pending D1 block
if [[ ${IN_D1_BLOCK} -eq 1 && ${HAS_DATABASE_ID_LINE} -eq 0 && -n "${CURRENT_DB_NAME}" ]]; then
  flush_current_d1_database_id >> "${TMP_FILE}"
fi

mv "${TMP_FILE}" "${WRANGLER_TOML}"

if [[ "${PLACEHOLDER_COUNT}" -eq 0 ]]; then
  echo "  (no D1 database_name -> database_id substitutions needed in ${WRANGLER_TOML})"
else
  echo "-> Resolved ${RESOLVED_COUNT}/${PLACEHOLDER_COUNT} D1 database ID(s) in ${WRANGLER_TOML}"
fi

echo "DONE: D1 ID resolution complete for ${SVC}"
