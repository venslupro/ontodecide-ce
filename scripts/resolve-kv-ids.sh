#!/usr/bin/env bash
# ============================================================================
# resolve-kv-ids.sh — Bridge Terraform-managed KV namespaces → wrangler.toml
#
# Problem:
#   The service wrangler.toml files contain placeholder KV namespace IDs
#   (`REPLACE_WITH_TERRAFORM_CREATED_*`).  Terraform creates the real
#   namespaces, but their IDs are deliberately NOT committed to git (see
#   infrastructure/terraform/outputs.tf — only titles are exported, never ids).
#   So `wrangler deploy` sends the literal placeholder to the Cloudflare API,
#   which rejects it with [code: 10042].
#
# Solution:
#   This script fetches the real KV namespace IDs from the Cloudflare API by
#   matching the deterministic namespace title, and substitutes them in the
#   service's wrangler.toml before `wrangler deploy` runs.
#
# Usage:
#   ./scripts/resolve-kv-ids.sh <service-dir>
#   e.g. ./scripts/resolve-kv-ids.sh apps/api/graph
#
# Env vars (required):
#   CF_ACCOUNT_ID  — Cloudflare account ID (32 hex)
#   CF_API_TOKEN   — Cloudflare API token (Workers KV read scope)
#
# Env vars (optional):
#   PROJECT_NAME   — defaults to "ontodecide"
#   ENVIRONMENT    — defaults to "production" (→ env_short "prd")
#
# KV namespace title convention (MUST match infrastructure/terraform/main.tf):
#   ${project_name}-${env_short}-${svc}-${lower(binding, _ → -)}
#   e.g. ontodecide-prd-graph-cache
# ============================================================================
set -euo pipefail

SERVICE_DIR="${1:?usage: resolve-kv-ids.sh <service-dir>}"
WRANGLER_TOML="${SERVICE_DIR}/wrangler.toml"

if [[ ! -f "${WRANGLER_TOML}" ]]; then
  echo "✘ wrangler.toml not found: ${WRANGLER_TOML}" >&2
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

# ---- Fetch all KV namespaces (single page covers ≤100 namespaces) --------
echo "→ Fetching KV namespaces from Cloudflare (prefix=${RES_PREFIX}, svc=${SVC})"
KV_JSON="$(curl -sfS \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces?per_page=100")"

API_SUCCESS="$(echo "${KV_JSON}" | jq -r '.success')"
if [[ "${API_SUCCESS}" != "true" ]]; then
  echo "✘ Cloudflare API returned failure:" >&2
  echo "${KV_JSON}" | jq '.errors' >&2
  echo "  Ensure CF_API_TOKEN has Workers KV Storage: Read scope." >&2
  exit 1
fi

# ---- Build title → id associative array -----------------------------------
declare -A KV_MAP
while IFS=$'\t' read -r title id; do
  [[ -n "${title}" ]] && KV_MAP["${title}"]="${id}"
done < <(echo "${KV_JSON}" | jq -r '.result[] | [.title, .id] | @tsv')

# ---- Patch wrangler.toml in place -----------------------------------------
# Walk the TOML line by line; when we see `binding = "..."` remember it,
# then when the next `id = "REPLACE_WITH_TERRAFORM_CREATED..."` appears,
# look up the real ID by computed title and substitute it.
CURRENT_BINDING=""
TMP_FILE="$(mktemp)"
PLACEHOLDER_COUNT=0
RESOLVED_COUNT=0

while IFS= read -r line; do
  # Track the current binding from the preceding `binding = "..."` line
  if [[ "${line}" =~ ^binding[[:space:]]*=[[:space:]]*\"([A-Z_]+)\" ]]; then
    CURRENT_BINDING="${BASH_REMATCH[1]}"
    printf '%s\n' "${line}"
    continue
  fi

  # Replace placeholder id lines only (leave real IDs untouched)
  if [[ "${line}" =~ id[[:space:]]*=[[:space:]]*\"REPLACE_WITH_TERRAFORM_CREATED ]]; then
    PLACEHOLDER_COUNT=$((PLACEHOLDER_COUNT + 1))
    if [[ -z "${CURRENT_BINDING}" ]]; then
      echo "✘ Found id placeholder but no preceding 'binding =' line" >&2
      exit 1
    fi
    # Compute title: ${res_prefix}-${svc}-${lower(binding, _ → -)}
    BINDING_LOWER_HYPHEN="$(echo "${CURRENT_BINDING}" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
    TITLE="${RES_PREFIX}-${SVC}-${BINDING_LOWER_HYPHEN}"
    REAL_ID="${KV_MAP[${TITLE}]:-}"
    if [[ -z "${REAL_ID}" ]]; then
      echo "✘ KV namespace not found for title: ${TITLE}" >&2
      echo "  Ensure Terraform has been applied (infrastructure/terraform/) to create KV namespaces." >&2
      exit 1
    fi
    echo "  ✓ ${SVC}/${CURRENT_BINDING} → ${TITLE} = ${REAL_ID}" >&2
    printf 'id = "%s"\n' "${REAL_ID}"
    RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
    continue
  fi

  printf '%s\n' "${line}"
done < "${WRANGLER_TOML}" > "${TMP_FILE}"

mv "${TMP_FILE}" "${WRANGLER_TOML}"

if [[ "${PLACEHOLDER_COUNT}" -eq 0 ]]; then
  echo "  (no KV placeholder IDs found in ${WRANGLER_TOML})"
else
  echo "→ Resolved ${RESOLVED_COUNT}/${PLACEHOLDER_COUNT} KV namespace ID(s) in ${WRANGLER_TOML}"
fi

echo "✓ KV ID resolution complete for ${SVC}"
