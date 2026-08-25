#!/usr/bin/env bash
# ============================================================================
# teardown-cloudflare.sh — Delete ALL Cloudflare resources for OntoDecide,
# regardless of which tool created them:
#   • Infrastructure layer (Terraform-owned): D1 shared-db / KV / Queues
#   • Code layer (wrangler deploy-owned): Workers / Cron / Pages / Domains
#
# Resources are matched by the ${PROJECT_NAME}-${ENV_SHORT}- prefix so
# multiple environments on the same CF account stay isolated.
#
# Deletion order (reverse of Terraform dependency order) is CRITICAL:
#   1. Cron triggers (must be removed before the referenced Worker)
#   2. Workers custom domains (must be removed before the bound Worker)
#   3. Strip Worker bindings (removes all queue consumers, KV/D1/service
#      bindings — required before Queues/KV/D1/Workers can be deleted)
#   4. Queues (after bindings stripped — no more consumers blocking deletion)
#   5. KV namespaces (after bindings stripped)
#   6. D1 shared database (after bindings stripped)
#   7. Workers scripts (Tier 3 → Tier 2 → Tier 1, last — all bindings gone)
#   8. Pages project (apps/web SPA hosting — after Workers)
#
# Resources are matched by the ${PROJECT_NAME}-${ENV_SHORT}- prefix, so
# staging/production envs on the same CF account are isolated.
#
# Compatibility: written for bash 3.2+ (works on macOS built-in /bin/bash
# as well as brew bash / zsh invoked via `bash script.sh`).
#
# Resources NOT touched (by design — external / account-wide):
#   • Backblaze B2 buckets (external IaC, outside Cloudflare)
#   • Neo4j AuraDB (external service)
#   • Zone-level settings / NS records (zone_id is optional in TF)
#   • Non-project resources (name prefix mismatch)
#
# Usage:
#   ./scripts/teardown-cloudflare.sh                    # preview + interactive confirm
#   ./scripts/teardown-cloudflare.sh --dry-run          # preview only, no API DELETE calls
#   ./scripts/teardown-cloudflare.sh --force            # skip interactive confirmation
#   ./scripts/teardown-cloudflare.sh --env staging      # target staging env
#   PROJECT_NAME=demo ./scripts/teardown-cloudflare.sh  # custom project prefix
#   ./scripts/teardown-cloudflare.sh --help
#
# Env vars (required):
#   CF_ACCOUNT_ID  — Cloudflare account ID (32 hex)
#   CF_API_TOKEN   — Cloudflare API token (must have destroy/delete scopes:
#                      Account.D1: Edit, Workers KV Storage: Edit,
#                      Account.Workers: Edit, Pages: Edit, Queues: Edit,
#                      Account.Workers Domains: Edit)
#
# Env vars (optional):
#   PROJECT_NAME   — defaults to "ontodecide"
#   ENVIRONMENT    — defaults to "production" (env_short "prd")
# ============================================================================
set -euo pipefail

# ============================================================================
# CLI parsing
# ============================================================================
usage() {
  cat <<'EOF'
Usage: teardown-cloudflare.sh [--dry-run] [--force] [--env ENV] [-h|--help]

  --dry-run      Print the API DELETE calls that would run, without
                 actually sending them. Good for a pre-flight review.
  --force        Skip the interactive confirmation prompt. Use in CI
                 pipelines (you are sure, have backups, etc.).
  --env ENV      Environment suffix. Default: "production".
                 Must match `terraform -var="environment=ENV"`.
  -h, --help     Show this help.

Environment variables:
  CF_ACCOUNT_ID  Cloudflare account ID (32 hex, REQUIRED)
  CF_API_TOKEN   Cloudflare API token with delete permissions (REQUIRED)
  PROJECT_NAME   Project name prefix. Default: "ontodecide".
                 Must match the Terraform `project_name` variable.
  ENVIRONMENT    Override default env (same as --env, CLI flag wins).
EOF
}

DRY_RUN=0
FORCE=0
ENVIRONMENT_FROM_CLI=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --force)   FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --env)
      [[ $# -ge 2 ]] || { echo "--env requires a value" >&2; exit 1; }
      ENVIRONMENT_FROM_CLI="$2"; shift 2 ;;
    --env=*)
      ENVIRONMENT_FROM_CLI="${1#*=}"; shift ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -n "${ENVIRONMENT_FROM_CLI}" ]]; then
  ENVIRONMENT="${ENVIRONMENT_FROM_CLI}"
else
  ENVIRONMENT="${ENVIRONMENT:-production}"
fi

PROJECT_NAME="${PROJECT_NAME:-ontodecide}"

case "${ENVIRONMENT}" in
  production) ENV_SHORT="prd" ;;
  staging)    ENV_SHORT="stg" ;;
  *)          ENV_SHORT="${ENVIRONMENT}" ;;
esac

RES_PREFIX="${PROJECT_NAME}-${ENV_SHORT}"

# ============================================================================
# Preconditions
# ============================================================================
: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID must be set}"
: "${CF_API_TOKEN:?CF_API_TOKEN must be set}"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: 'jq' is required but not found. Install via 'brew install jq' or equivalent." >&2
  exit 1
fi

# ============================================================================
# Shared API helpers
# ============================================================================
CF_AUTH_HEADERS=(
  -H "Authorization: Bearer ${CF_API_TOKEN}"
  -H "Content-Type: application/json"
)
CF_API_BASE="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}"

banner() {
  if [[ -t 1 ]]; then
    printf '\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"
  else
    printf '==> %s\n' "$*"
  fi
}

ok()   { if [[ -t 1 ]]; then printf '\033[1;32m  OK\033[0m %s\n' "$*"; else printf '  OK %s\n' "$*"; fi; }
info() { if [[ -t 1 ]]; then printf '\033[1;36m  ->\033[0m %s\n' "$*"; else printf '  -> %s\n' "$*"; fi; }
warn() { if [[ -t 1 ]]; then printf '\033[1;33m  WARN\033[0m %s\n' "$*"; else printf '  WARN %s\n' "$*"; fi; }
err()  { if [[ -t 1 ]]; then printf '\033[1;31m  ERR\033[0m %s\n' "$*" >&2; else printf '  ERR %s\n' "$*" >&2; fi; }

# cf_api: run an authenticated CF V4 call. Echoes raw JSON on success;
# returns non-zero + prints errors to stderr on failure.
cf_api() {
  local method="$1"; shift
  local path="$1"; shift
  local resp http_code api_success
  # -w '%{http_code}' appends HTTP status as last 3 chars; -o captures body.
  # We don't use -f so 4xx/5xx bodies are retained for error parsing.
  resp="$(curl -sS -w '\n%{http_code}' -X "${method}" "${CF_AUTH_HEADERS[@]}" "$@" \
    "${CF_API_BASE}/${path}")" || true
  if [[ -z "${resp}" ]]; then
    err "Cloudflare ${method} /${path}: empty response (network / DNS issue?)"
    return 1
  fi
  # Split body and HTTP status code (last line)
  http_code="$(printf '%s' "${resp}" | tail -1)"
  local body
  body="$(printf '%s' "${resp}" | sed '$d')"
  api_success="$(printf '%s' "${body}" | jq -r '.success // "false"' 2>/dev/null || echo "false")"
  if [[ "${api_success}" != "true" ]]; then
    err "Cloudflare ${method} /${path} failed (HTTP ${http_code}):"
    # Try to pretty-print errors; fall back to raw body
    printf '%s' "${body}" | jq '.errors // .' 2>/dev/null >&2 || printf '%s\n' "${body}" >&2
    return 1
  fi
  printf '%s' "${body}"
}

# cf_delete: run cf_api DELETE (or print + skip when DRY_RUN=1)
cf_delete() {
  local label="$1"
  local path="$2"
  local display="${3:-$path}"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] DELETE ${label} — ${display}"
    return 0
  fi
  if cf_api DELETE "${path}" >/dev/null; then
    ok "deleted ${label} — ${display}"
  else
    err "failed to delete ${label} — ${display}"
    return 1
  fi
}

# cf_list_prefixed: paginate a GET list endpoint, filter rows whose first
# JQ-field starts with RES_PREFIX. Echoes TSV rows (tab-separated) to stdout.
# Empty output = nothing found / API error (errors printed to stderr).
# Uses per_page/page pagination; some endpoints (e.g. Pages Projects) don't
# support these params — call cf_list_all instead for those.
cf_list_prefixed() {
  local path="$1"
  local filter="$2"
  local page=1
  local per_page=100
  local all_json="[]"
  local total_pages=1 chunk page_json

  while [[ ${page} -le ${total_pages} ]]; do
    if ! chunk="$(cf_api GET "${path}?per_page=${per_page}&page=${page}")"; then
      return 0
    fi
    total_pages="$(echo "${chunk}" | jq -r '.result_info.total_pages // 1')"
    page_json="$(echo "${chunk}" | jq -c '.result // []')"
    all_json="$(printf '%s' "${all_json}" | jq -c --argjson p "${page_json}" '. + $p')"
    page=$((page + 1))
  done

  printf '%s' "${all_json}" | jq -r --arg pfx "${RES_PREFIX}" \
    "${filter} | select(.[0] | startswith(\$pfx)) | @tsv"
}

# cf_list_all: like cf_list_prefixed but without pagination params (for
# endpoints like Pages Projects that reject per_page/page query args).
cf_list_all() {
  local path="$1"
  local filter="$2"
  local chunk

  if ! chunk="$(cf_api GET "${path}")"; then
    return 0
  fi

  # Extract .result array first, then apply caller's filter
  printf '%s' "${chunk}" | jq -c '.result // []' | \
    jq -r --arg pfx "${RES_PREFIX}" \
      "${filter} | select(.[0] | startswith(\$pfx)) | @tsv"
}

# Helper: delete a TSV stream via cf_delete (pipeline-safe; does not need
# parent-scope variable writes, so a pipe-subshell is fine).
# Args: label_prefix path_template display_col_count
#   For each row of TSV input:
#     col1 is the "name" (used in both label and RES_PREFIX filter)
#     path_template has {{ID}} replaced with the id column (col2)
#     display is constructed from remaining cols
delete_tsv_rows() {
  local label_prefix="$1"
  local path_template="$2"
  local row label display api_path name id
  while IFS=$'\t' read -r name id _rest; do
    [[ -z "${name:-}" ]] && continue
    label="${label_prefix} ${name}"
    api_path="${path_template//\{\{ID\}\}/${id}}"
    display="[${id}]"
    cf_delete "${label}" "${api_path}" "${display}"
  done
}

# ============================================================================
# Banner
# ============================================================================
echo "============================================================"
echo " OntoDecide — Cloudflare Resource Teardown"
echo "============================================================"
echo " PROJECT_NAME : ${PROJECT_NAME}"
echo " ENVIRONMENT  : ${ENVIRONMENT} (${ENV_SHORT})"
echo " RES_PREFIX   : ${RES_PREFIX}"
echo " CF_ACCOUNT   : ${CF_ACCOUNT_ID:0:8}...${CF_ACCOUNT_ID: -8}"
echo " DRY_RUN      : $([[ ${DRY_RUN} -eq 1 ]] && echo YES || echo no)"
echo "============================================================"

# ============================================================================
# Interactive confirmation
# ============================================================================
if [[ "${DRY_RUN}" -eq 0 && "${FORCE}" -eq 0 ]]; then
  warn "This will PERMANENTLY DELETE all Cloudflare resources with prefix '${RES_PREFIX}':"
  warn "  - Workers scripts (gateway/user/ai/graph/ingestion/cleanup)"
  warn "  - Cron triggers, Pages project, custom domains"
  warn "  - Queues + DLQs, KV namespaces, D1 shared database"
  warn ""
  warn "Data in KV/D1/Queues will be IRRECOVERABLE after deletion."
  warn ""
  read -r -p "Type 'YES, DELETE ALL ${RES_PREFIX} RESOURCES' to proceed: " reply
  expected="YES, DELETE ALL ${RES_PREFIX} RESOURCES"
  if [[ "${reply}" != "${expected}" ]]; then
    echo ""
    err "Confirmation mismatch. Aborted (no changes made)."
    exit 2
  fi
fi

# ============================================================================
# Step 1 — Cron triggers
#    Cron is stored per-Worker as schedules[]; we clear them by PUTting
#    an empty schedules array before Worker deletion.
# ============================================================================
banner "Step 1/8: Cron Triggers"
CRON_WORKERS=(
  "${RES_PREFIX}-cleanup"
)
for worker_name in "${CRON_WORKERS[@]}"; do
  info "Checking cron schedules for: ${worker_name}"
  sched_json="$(cf_api GET "workers/scripts/${worker_name}/schedules" 2>/dev/null || true)"
  if [[ -z "${sched_json}" ]]; then
    info "  (Worker not found or no schedules — skipping)"
    continue
  fi
  sched_count="$(echo "${sched_json}" | jq -r '.result | length')"
  if [[ "${sched_count}" -eq "0" ]]; then
    info "  (no schedules)"
    continue
  fi
  info "  found ${sched_count} schedule(s) — clearing via PUT empty array"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] PUT workers/scripts/${worker_name}/schedules with []"
  else
    if cf_api PUT "workers/scripts/${worker_name}/schedules" \
        -d '[]' >/dev/null; then
      ok "cleared cron schedules for ${worker_name}"
    else
      err "failed to clear cron for ${worker_name} (continuing — Worker delete may clear it)"
    fi
  fi
done

# ============================================================================
# Step 2 — Workers custom domains
# ============================================================================
banner "Step 2/8: Workers Custom Domains"
domain_rows="$(cf_list_prefixed "workers/domains" \
  '.[] | [.hostname, .id, .service]')"
if [[ -z "${domain_rows}" ]]; then
  info "  (no custom domains found with prefix ${RES_PREFIX})"
else
  printf '%s\n' "${domain_rows}" | delete_tsv_rows "custom domain" "workers/domains/{{ID}}"
fi

# ============================================================================
# Step 3 — Strip ALL Worker bindings
#    Workers hold queue consumer, KV, D1, and service bindings that block
#    deletion of those resources AND the Workers themselves. We redeploy
#    each Worker with a minimal sentinel script and EMPTY bindings via PUT
#    (multipart form upload), releasing all references.
# ============================================================================
banner "Step 3/8: Strip Worker Bindings"

# Fetch all workers now — reused in Step 7 (Worker deletion) too
all_worker_rows="$(cf_list_prefixed "workers/scripts" \
  '.[] | [.id, .id, .modified_on]')"
existing_workers="$(printf '%s\n' "${all_worker_rows}" | cut -f1)"

# Minimal ES module sentinel script — includes queue() handler so Cloudflare
# accepts the upload even when the Worker currently has queue consumer bindings
SENTINEL_JS='export default{fetch(){return new Response("teardown sentinel",{status:503})},async queue(){}}'

# Metadata JSON with empty bindings — this is what clears all references
# (queue consumers, KV, D1, service bindings all gone)
STRIP_METADATA='{"main_module":"index.js","bindings":[],"compatibility_date":"2024-10-01","compatibility_flags":["nodejs_compat"]}'

for worker_name in $(printf '%s\n' "${existing_workers}" 2>/dev/null); do
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] PUT workers/scripts/${worker_name} (minimal script, empty bindings)"
    continue
  fi
  # Use temp files for multipart form upload
  meta_tmp="$(mktemp /tmp/teardown-meta.XXXXXX.json)"
  script_tmp="$(mktemp /tmp/teardown-script.XXXXXX.js)"
  printf '%s' "${STRIP_METADATA}" > "${meta_tmp}"
  printf '%s' "${SENTINEL_JS}" > "${script_tmp}"

  resp="$(curl -sS -w '\n%{http_code}' -X PUT \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -F "metadata=@${meta_tmp};type=application/json" \
    -F "index.js=@${script_tmp};filename=index.js;type=application/javascript+module" \
    "${CF_API_BASE}/workers/scripts/${worker_name}")" || true

  rm -f "${meta_tmp}" "${script_tmp}"

  http_code="$(printf '%s' "${resp}" | tail -1)"
  body="$(printf '%s' "${resp}" | sed '$d')"
  api_success="$(printf '%s' "${body}" | jq -r '.success // "false"' 2>/dev/null || echo "false")"
  if [[ "${api_success}" == "true" ]]; then
    ok "stripped bindings for ${worker_name}"
  else
    err_msg="$(printf '%s' "${body}" | jq -r '.errors[0].message // "unknown"' 2>/dev/null || echo "HTTP ${http_code}")"
    warn "could not strip bindings for ${worker_name} (HTTP ${http_code}): ${err_msg}"
  fi
done

# ============================================================================
# Step 4 — Queues (bindings stripped — no more consumers blocking deletion)
# ============================================================================
banner "Step 4/8: Queues (main + DLQ)"
# Cloudflare Queues DELETE uses queue_name in the URL path.
queue_rows="$(cf_list_prefixed "workers/queues" \
  '.[] | [.queue_name, .queue_name]')"
if [[ -z "${queue_rows}" ]]; then
  info "  (no queues found with prefix ${RES_PREFIX})"
else
  printf '%s\n' "${queue_rows}" | delete_tsv_rows "queue" "workers/queues/{{ID}}"
fi

# ============================================================================
# Step 4 — KV namespaces
#    Cloudflare Provider v5 uses new /storage/kv/namespaces path (the
#    legacy /workers/namespaces was deprecated 2026-07-15 and breaks
#    2026-10-15).
# ============================================================================
banner "Step 5/8: KV Namespaces"
kv_rows="$(cf_list_prefixed "storage/kv/namespaces" \
  '.[] | [.title, .id, .supports_url_encoding // ""]')"
if [[ -z "${kv_rows}" ]]; then
  info "  (no KV namespaces found with prefix ${RES_PREFIX})"
else
  printf '%s\n' "${kv_rows}" | delete_tsv_rows "KV namespace" "storage/kv/namespaces/{{ID}}"
fi

# ============================================================================
# Step 5 — D1 databases (before Workers — removing DB releases D1 bindings)
# ============================================================================
banner "Step 6/8: D1 Databases (shared-db)"
d1_rows="$(cf_list_prefixed "d1/database" \
  '.[] | [.name, .uuid, .created_at]')"
if [[ -z "${d1_rows}" ]]; then
  info "  (no D1 databases found with prefix ${RES_PREFIX})"
else
  printf '%s\n' "${d1_rows}" | delete_tsv_rows "D1 database" "d1/database/{{ID}}"
fi

# ============================================================================
# Step 6 — Workers scripts (LAST resource — after all bindings to Queues,
#    KV, D1 are removed. Reverse dependency order: gateway → ingestion →
#    leaf services, so Service Bindings are cleaned up naturally.)
# ============================================================================
banner "Step 7/8: Workers Scripts (reverse dependency order)"
WORKER_DELETE_ORDER=(
  "${RES_PREFIX}-gateway"
  "${RES_PREFIX}-ingestion"
  "${RES_PREFIX}-user"
  "${RES_PREFIX}-ai"
  "${RES_PREFIX}-graph"
  "${RES_PREFIX}-cleanup"
)

# Worker list and existing_workers were fetched in Step 3 (Strip Bindings)
worker_exists() {
  local target="$1"
  [[ -n "${existing_workers}" ]] || return 1
  printf '%s\n' "${existing_workers}" | grep -qx "${target}"
}

cf_delete_worker() {
  local worker_name="$1"

  if ! worker_exists "${worker_name}"; then
    info "  Worker not found (already deleted?): ${worker_name}"
    return 0
  fi

  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "[dry-run] DELETE worker ${worker_name}"
    return 0
  fi

  local resp_body http_code body api_success err_msg
  resp_body="$(curl -sS -w '\n%{http_code}' -X DELETE \
    "${CF_AUTH_HEADERS[@]}" \
    "${CF_API_BASE}/workers/scripts/${worker_name}")" || true
  http_code="$(printf '%s' "${resp_body}" | tail -1)"
  body="$(printf '%s' "${resp_body}" | sed '$d')"

  api_success="$(printf '%s' "${body}" | jq -r '.success // "false"' 2>/dev/null || echo "false")"
  if [[ "${api_success}" == "true" ]]; then
    ok "deleted worker ${worker_name}"
    return 0
  fi

  if [[ "${http_code}" == "404" ]]; then
    info "  Worker not found (already deleted?): ${worker_name}"
    return 0
  fi

  err_msg="$(printf '%s' "${body}" | jq -r '.errors[0].message // .errors[0].code // "unknown"' 2>/dev/null || echo "")"
  if echo "${err_msg}" | grep -qi "not found\|could not find\|unknown script"; then
    info "  Worker not found (already deleted?): ${worker_name}"
    return 0
  fi

  err "failed to delete worker ${worker_name} (HTTP ${http_code}): ${err_msg}"
  return 1
}

for worker_name in "${WORKER_DELETE_ORDER[@]}"; do
  cf_delete_worker "${worker_name}" || true
done

# Catch stragglers (any prefix-matched worker not in the ordered list)
if [[ -n "${all_worker_rows}" ]]; then
  while IFS=$'\t' read -r name _id _rest; do
    [[ -z "${name:-}" ]] && continue
    already_handled=0
    for ordered in "${WORKER_DELETE_ORDER[@]}"; do
      if [[ "${ordered}" == "${name}" ]]; then
        already_handled=1
        break
      fi
    done
    if [[ ${already_handled} -eq 0 ]]; then
      warn "  Found extra project-prefixed Worker not in TF list: ${name}"
      cf_delete_worker "${name}" || true
    fi
  done <<EOF_WORKERS
${all_worker_rows}
EOF_WORKERS
fi

# ============================================================================
# Step 8 — Pages project (after Workers — per user request)
# ============================================================================
banner "Step 8/8: Pages Projects"
pages_rows="$(cf_list_all "pages/projects" \
  '.[] | [.name, .id, .canonical_deployment.url // ""]')"
if [[ -z "${pages_rows}" ]]; then
  info "  (no pages projects found with prefix ${RES_PREFIX})"
else
  while IFS=$'\t' read -r pname pid purl; do
    [[ -z "${pname:-}" ]] && continue
    display="[${pid}]"
    cf_delete "pages project ${pname}" "pages/projects/${pname}" "${display}"
  done <<EOF_PAGES
${pages_rows}
EOF_PAGES
fi

# ============================================================================
# Final summary
# ============================================================================
banner "Teardown complete"
if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo " Mode: DRY RUN — no resources were actually deleted."
  echo " Run again WITHOUT --dry-run (and with --force or manual confirmation)"
  echo " to execute deletions against Cloudflare."
else
  echo " All Cloudflare resources with prefix '${RES_PREFIX}' have been deleted."
  echo ""
  echo " Note: Terraform remote state still references these resources."
  echo "       To clean the state (B2 S3 backend), run:"
  echo "         cd infrastructure/terraform"
  echo "         terraform init -upgrade -backend-config=..."
  echo "         terraform state list"
  echo "         terraform state list | xargs -L1 terraform state rm"
fi
echo ""
echo " External resources still exist (NOT touched by this script):"
echo "   - Backblaze B2 buckets:  ${PROJECT_NAME}-${ENV_SHORT}-ingestion-staging"
echo "                            ${PROJECT_NAME}-${ENV_SHORT}-tenant-archive"
echo "                            ${PROJECT_NAME}-${ENV_SHORT}-terraform-state"
echo "   - Neo4j AuraDB instance  (property-isolated shared db)"
echo "============================================================"
