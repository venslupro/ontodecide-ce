#!/usr/bin/env bash
#
# Deletes every deployed OntoDecide resource and service so the next
# deploy starts from zero. Irreversible: back up or migrate data before
# running it. Never run by CI.
#
#   scripts/reset.sh [--dry-run] [--yes] [--legacy] [--env-file FILE]
#
#   --dry-run  Only list what would be deleted.
#   --yes      Skip the confirmation prompt.
#   --legacy   Also delete resources with pre-{project}-{env} names
#              (api-gateway, identity-access-db, ingest, ontodecide-ce-raw,
#              …). Exact names only; make sure nothing else in the account
#              uses them.
#   --env-file Local credentials file (default .env.local), relative to the
#              current directory. The script needs no checkout and runs from
#              anywhere.
#
# Output is colored on a terminal; NO_COLOR=1 turns colors off and
# FORCE_COLOR=1 keeps them when piped.
#
# Deleted, in dependency order: Pages project, 7 Workers, queues, D1, KV,
# Vectorize index, B2 raw bucket (emptied first) and its key, Neo4j Aura
# instance, then the deployment state file (earlier versions are kept).
#
# Requires curl, jq and these variables, from the local credentials file
# (KEY=value lines, chmod 600) or the environment:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY      (B2 master key)
#   AURA_CLIENT_ID, AURA_CLIENT_SECRET
# The CI secret names (CF_API_TOKEN, B2_MASTER_KEY, …) are accepted too.

set -euo pipefail

readonly PROJECT="ontodecide"
readonly ENVIRONMENT="prd"
readonly PREFIX="${PROJECT}-${ENVIRONMENT}"
readonly PAGES_PROJECT="ontodecide-ce" # exempt from the naming rule
readonly STATE_BUCKET="ontodecide-ce-tfstate"
readonly STATE_KEY="terraform.tfstate" # infra/versions.tf backend key
readonly CF_API="https://api.cloudflare.com/client/v4"
readonly AURA_API="https://api.neo4j.io"
readonly TOTAL_STEPS=10

readonly -a SERVICES=(
  identity-access ontology-manager data-integration object-graph
  situation-awareness decision-engine
)
# Root → leaf, so no Worker is deleted while another still binds to it.
readonly -a WORKERS=(
  api-gateway identity-access decision-engine situation-awareness
  object-graph data-integration ontology-manager
)
readonly -a QUEUES=(
  ingest object-writes graph-sync situation-events decision-jobs
)

# Progress counters, updated by step() and act().
step_num=0
step_items=0
deleted_count=0
planned_count=0
failure_count=0

#######################################
# Sets the color codes: on a terminal or with FORCE_COLOR, never with
# NO_COLOR (https://no-color.org).
# Globals:
#   BOLD DIM RED GREEN YELLOW CYAN RESET (set, readonly)
# Arguments:
#   None
#######################################
setup_colors() {
  if [[ -z "${NO_COLOR:-}" ]] \
    && { [[ -n "${FORCE_COLOR:-}" ]] \
      || [[ -t 1 && "${TERM:-}" != dumb ]]; }; then
    BOLD=$'\033[1m'
    DIM=$'\033[2m'
    RED=$'\033[31m'
    GREEN=$'\033[32m'
    YELLOW=$'\033[33m'
    CYAN=$'\033[36m'
    RESET=$'\033[0m'
  else
    BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
  fi
  readonly BOLD DIM RED GREEN YELLOW CYAN RESET
}

# Prints an error message to STDERR.
err() {
  printf '%s✗ error:%s %s\n' "${RED}${BOLD}" "${RESET}" "$*" >&2
}

# Prints a warning message to STDERR.
warn() {
  printf '%s! warning:%s %s\n' "${YELLOW}${BOLD}" "${RESET}" "$*" >&2
}

# Prints the header comment of this file as help text.
usage() {
  awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' \
    "$0"
}

#######################################
# Parses the command-line options.
# Globals:
#   DRY_RUN ASSUME_YES LEGACY ENV_FILE (set, readonly)
# Arguments:
#   The script's arguments.
#######################################
parse_args() {
  DRY_RUN=false
  ASSUME_YES=false
  LEGACY=false
  ENV_FILE=".env.local"
  while (($# > 0)); do
    case "$1" in
      --dry-run) DRY_RUN=true ;;
      --yes) ASSUME_YES=true ;;
      --legacy) LEGACY=true ;;
      --env-file)
        if (($# < 2)); then
          err "--env-file needs a path"
          exit 2
        fi
        ENV_FILE="$2"
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        err "unknown option: $1 (see --help)"
        exit 2
        ;;
    esac
    shift
  done
  readonly DRY_RUN ASSUME_YES LEGACY ENV_FILE
}

#######################################
# Loads the credentials file (if any) and checks every required setting.
# Globals:
#   ENV_FILE
#   CONFIG_SOURCE CF_TOKEN CF_ACCOUNT B2_ID B2_KEY AURA_ID AURA_SECRET
#   (set, readonly)
# Arguments:
#   None
# Outputs:
#   Writes missing settings to STDERR and exits 1 if any.
#######################################
load_config() {
  CONFIG_SOURCE="environment variables"
  if [[ -f "${ENV_FILE}" ]]; then
    CONFIG_SOURCE="${ENV_FILE}"
    if [[ -n "$(find "${ENV_FILE}" -perm -004)" ]]; then
      warn "${ENV_FILE} is world-readable (run: chmod 600 ${ENV_FILE})"
    fi
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  elif [[ "${ENV_FILE}" != ".env.local" ]]; then
    err "config file ${ENV_FILE} not found"
    exit 1
  fi

  CF_TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
  CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
  B2_ID="${B2_APPLICATION_KEY_ID:-${B2_MASTER_KEY_ID:-}}"
  B2_KEY="${B2_APPLICATION_KEY:-${B2_MASTER_KEY:-}}"
  AURA_ID="${AURA_CLIENT_ID:-${NEO4J_AURA_CLIENT_ID:-}}"
  AURA_SECRET="${AURA_CLIENT_SECRET:-${NEO4J_AURA_CLIENT_SECRET:-}}"
  readonly CONFIG_SOURCE CF_TOKEN CF_ACCOUNT B2_ID B2_KEY AURA_ID \
    AURA_SECRET

  local -a missing=()
  local pair var bin item
  for pair in CF_TOKEN:CLOUDFLARE_API_TOKEN \
    CF_ACCOUNT:CLOUDFLARE_ACCOUNT_ID \
    B2_ID:B2_APPLICATION_KEY_ID \
    B2_KEY:B2_APPLICATION_KEY \
    AURA_ID:AURA_CLIENT_ID \
    AURA_SECRET:AURA_CLIENT_SECRET; do
    var="${pair%%:*}"
    [[ -n "${!var}" ]] || missing+=("${pair#*:}")
  done
  for bin in curl jq; do
    command -v "${bin}" >/dev/null || missing+=("command:${bin}")
  done
  if ((${#missing[@]} > 0)); then
    err "missing configuration in ${CONFIG_SOURCE} (see --help):"
    for item in "${missing[@]}"; do
      printf '    %s•%s %s\n' "${RED}" "${RESET}" "${item}" >&2
    done
    exit 1
  fi
}

#######################################
# Prints the names of one resource kind: current names, plus legacy ones
# with --legacy.
# Globals:
#   PREFIX LEGACY SERVICES WORKERS QUEUES
# Arguments:
#   Resource kind: worker, queue, d1, kv, vectorize, b2-bucket, b2-key or
#   neo4j.
# Outputs:
#   One name per line to STDOUT.
#######################################
names() {
  local kind="$1"
  local set pre name
  for set in current legacy; do
    if [[ "${set}" == legacy ]]; then
      [[ "${LEGACY}" == true ]] || continue
      pre=""
    else
      pre="${PREFIX}-"
    fi
    case "${kind}" in
      worker)
        for name in "${WORKERS[@]}"; do
          echo "${pre}${name}"
        done
        ;;
      queue)
        for name in "${QUEUES[@]}"; do
          echo "${pre}${name}"
          echo "${pre}${name}-dlq"
        done
        ;;
      d1)
        for name in "${SERVICES[@]}"; do
          echo "${pre}${name}-db"
        done
        ;;
      kv)
        if [[ "${set}" == legacy ]]; then
          echo "ontology-schema-cache"
          echo "api-gateway-config"
        else
          echo "${pre}schema-cache"
          echo "${pre}gateway-config"
        fi
        ;;
      vectorize) echo "${pre}decision-cases-bge-m3" ;;
      b2-bucket)
        if [[ "${set}" == legacy ]]; then
          echo "ontodecide-ce-raw"
        else
          echo "${pre}raw"
        fi
        ;;
      b2-key) echo "${pre}data-integration" ;;
      neo4j)
        if [[ "${set}" == legacy ]]; then
          echo "ontodecide-ce-graph"
        else
          echo "${pre}graphdb"
        fi
        ;;
      *)
        err "unknown resource kind: ${kind}"
        return 1
        ;;
    esac
  done
}

# Prints the ids of name $1 from "name id" lines on STDIN.
id_of() {
  awk -v n="$1" '$1 == n { print $2 }'
}

# Closes the current step, noting when it found nothing.
step_end() {
  if ((step_num > 0 && step_items == 0)); then
    printf '  %s– nothing to delete%s\n' "${DIM}" "${RESET}"
  fi
}

# Starts the next numbered step, titled $1.
step() {
  step_end
  ((step_num += 1))
  step_items=0
  printf '\n%sStep %d/%d%s  %s%s%s\n' "${CYAN}${BOLD}" "${step_num}" \
    "${TOTAL_STEPS}" "${RESET}" "${BOLD}" "$1" "${RESET}"
}

# Prints informational text $2 in color $1 inside the current step.
note() {
  ((step_items += 1))
  printf '  %s%s%s\n' "$1" "$2" "${RESET}"
}

#######################################
# Deletes one resource by running a command, unless --dry-run.
# Globals:
#   DRY_RUN step_items deleted_count planned_count failure_count
# Arguments:
#   Resource description, then the command and its arguments.
# Outputs:
#   The outcome to STDOUT (failures to STDERR).
#######################################
act() {
  local what="$1"
  shift
  ((step_items += 1))
  if [[ "${DRY_RUN}" == true ]]; then
    printf '  %s○ would delete%s %s\n' "${YELLOW}" "${RESET}" "${what}"
    ((planned_count += 1))
  elif "$@"; then
    printf '  %s✓ deleted%s      %s\n' "${GREEN}" "${RESET}" "${what}"
    ((deleted_count += 1))
  else
    printf '  %s✗ failed%s       %s\n' "${RED}${BOLD}" "${RESET}" \
      "${what}" >&2
    ((failure_count += 1))
  fi
}

# Calls the Cloudflare account API: cf METHOD PATH; prints the JSON body.
cf() {
  curl -sS -X "$1" -H "Authorization: Bearer ${CF_TOKEN}" \
    "${CF_API}/accounts/${CF_ACCOUNT}$2"
}

# Succeeds if the Cloudflare call cf METHOD PATH reports success.
cf_ok() {
  cf "$@" | jq -e '.success == true' >/dev/null
}

#######################################
# Prints a jq filter over every page of a Cloudflare collection.
# Arguments:
#   Collection path, jq filter applied to each item.
# Outputs:
#   The filter results to STDOUT.
#######################################
cf_list() {
  local path="$1"
  local filter="$2"
  local page=1
  local sep='?'
  local body
  [[ "${path}" != *\?* ]] || sep='&'
  while true; do
    body="$(cf GET "${path}${sep}page=${page}&per_page=100")"
    jq -r ".result[]? | ${filter}" <<<"${body}"
    (($(jq '.result | length' <<<"${body}") < 100)) && break
    ((page += 1))
  done
}

# Calls the Backblaze B2 native API: b2 CALL JSON; prints the JSON body.
b2() {
  curl -sS -H "Authorization: ${B2_TOKEN}" -d "$2" \
    "${B2_API}/b2api/v3/$1"
}

# Prints the id of B2 bucket $1, or nothing if it does not exist.
b2_bucket_id() {
  local request
  request="$(jq -nc --arg a "${B2_ACCOUNT}" --arg n "$1" \
    '{accountId: $a, bucketName: $n}')"
  b2 b2_list_buckets "${request}" | jq -r '.buckets[0]?.bucketId // empty'
}

#######################################
# Authorizes the B2 master key.
# Globals:
#   B2_ID B2_KEY
#   B2_TOKEN B2_API B2_ACCOUNT (set, readonly)
# Arguments:
#   None
#######################################
b2_authorize() {
  local auth
  auth="$(curl -sS -u "${B2_ID}:${B2_KEY}" \
    https://api.backblazeb2.com/b2api/v3/b2_authorize_account)"
  B2_TOKEN="$(jq -r '.authorizationToken // empty' <<<"${auth}")"
  B2_API="$(jq -r '.apiInfo.storageApi.apiUrl // empty' <<<"${auth}")"
  B2_ACCOUNT="$(jq -r '.accountId // empty' <<<"${auth}")"
  readonly B2_TOKEN B2_API B2_ACCOUNT
  if [[ -z "${B2_TOKEN}" ]]; then
    err "B2 authorization failed" \
      "(check B2_APPLICATION_KEY_ID / B2_APPLICATION_KEY)"
    exit 1
  fi
}

#######################################
# Authorizes the Aura API client.
# Globals:
#   AURA_ID AURA_SECRET
#   AURA_TOKEN (set, readonly)
# Arguments:
#   None
#######################################
aura_authorize() {
  AURA_TOKEN="$(curl -sS -u "${AURA_ID}:${AURA_SECRET}" \
    -d grant_type=client_credentials "${AURA_API}/oauth/token" \
    | jq -r '.access_token // empty')"
  readonly AURA_TOKEN
  if [[ -z "${AURA_TOKEN}" ]]; then
    err "Aura authorization failed" \
      "(check AURA_CLIENT_ID / AURA_CLIENT_SECRET)"
    exit 1
  fi
}

# Prints the target, mode and config source.
print_banner() {
  local legacy_note=""
  [[ "${LEGACY}" != true ]] || legacy_note=" + legacy names"
  printf '%sOntoDecide reset%s\n' "${BOLD}" "${RESET}"
  printf '  %starget%s   %s%s\n' "${DIM}" "${RESET}" "${PREFIX}" \
    "${legacy_note}"
  if [[ "${DRY_RUN}" == true ]]; then
    printf '  %smode%s     %sdry run%s (nothing is deleted)\n' \
      "${DIM}" "${RESET}" "${YELLOW}${BOLD}" "${RESET}"
  else
    printf '  %smode%s     %sLIVE%s (resources are deleted)\n' \
      "${DIM}" "${RESET}" "${RED}${BOLD}" "${RESET}"
  fi
  printf '  %sconfig%s   %s\n' "${DIM}" "${RESET}" "${CONFIG_SOURCE}"
}

# Asks for the prefix before a live run unless --yes; exits 1 otherwise.
confirm() {
  local answer
  [[ "${DRY_RUN}" == false && "${ASSUME_YES}" == false ]] || return 0
  printf '\n%sThis permanently deletes all %s resources, services and' \
    "${RED}${BOLD}" "${PREFIX}"
  printf ' data.%s\n' "${RESET}"
  read -r -p "Type ${PREFIX} to continue: " answer
  if [[ "${answer}" != "${PREFIX}" ]]; then
    warn "aborted; nothing was deleted"
    exit 1
  fi
}

# Deletes the Pages project, emptying it first if it has many deployments.
delete_pages_project() {
  local path="/pages/projects/${PAGES_PROJECT}"
  local id
  cf_ok DELETE "${path}" && return 0
  while IFS= read -r id; do
    cf DELETE "${path}/deployments/${id}?force=true" >/dev/null
  done < <(cf_list "${path}/deployments" '.id')
  cf_ok DELETE "${path}"
}

reset_pages() {
  step "Delete Pages project"
  if cf_ok GET "/pages/projects/${PAGES_PROJECT}"; then
    act "${PAGES_PROJECT}" delete_pages_project
  fi
}

reset_workers() {
  local existing name
  step "Delete Workers"
  existing="$(cf GET /workers/scripts | jq -r '.result[]?.id')"
  while IFS= read -r name; do
    grep -qxF "${name}" <<<"${existing}" || continue
    act "${name}" cf_ok DELETE "/workers/scripts/${name}?force=true"
  done < <(names worker)
}

#######################################
# Deletes the Cloudflare resources of one kind that are listed by id.
# Arguments:
#   Step title, names() kind, collection path, jq filter printing
#   "name id" for each item.
#######################################
reset_listed() {
  local title="$1"
  local kind="$2"
  local path="$3"
  local filter="$4"
  local existing name id
  step "${title}"
  existing="$(cf_list "${path}" "${filter}")"
  while IFS= read -r name; do
    id="$(id_of "${name}" <<<"${existing}")"
    [[ -n "${id}" ]] || continue
    act "${name}" cf_ok DELETE "${path}/${id}"
  done < <(names "${kind}")
}

reset_vectorize() {
  local name
  step "Delete Vectorize index"
  while IFS= read -r name; do
    cf_ok GET "/vectorize/v2/indexes/${name}" || continue
    act "${name}" cf_ok DELETE "/vectorize/v2/indexes/${name}"
  done < <(names vectorize)
}

#######################################
# Deletes every file version and unfinished upload of a B2 bucket, then
# the bucket.
# Globals:
#   B2_ACCOUNT
# Arguments:
#   Bucket id.
# Returns:
#   0 if the bucket was deleted, non-zero otherwise.
#######################################
delete_bucket() {
  local bucket="$1"
  local next_name=""
  local next_id=""
  local request body file id
  while true; do
    request="$(jq -nc --arg b "${bucket}" --arg n "${next_name}" \
      --arg i "${next_id}" '{bucketId: $b, maxFileCount: 1000}
        + (if $n != "" then {startFileName: $n, startFileId: $i}
           else {} end)')"
    body="$(b2 b2_list_file_versions "${request}")"
    while IFS= read -r file; do
      b2 b2_delete_file_version \
        "$(jq -c '. + {bypassGovernance: true}' <<<"${file}")" >/dev/null
    done < <(jq -c '.files[]? | {fileName, fileId}' <<<"${body}")
    next_name="$(jq -r '.nextFileName // empty' <<<"${body}")"
    next_id="$(jq -r '.nextFileId // empty' <<<"${body}")"
    [[ -n "${next_name}" ]] || break
  done

  request="$(jq -nc --arg b "${bucket}" '{bucketId: $b}')"
  while IFS= read -r id; do
    b2 b2_cancel_large_file "$(jq -nc --arg i "${id}" '{fileId: $i}')" \
      >/dev/null
  done < <(b2 b2_list_unfinished_large_files "${request}" \
    | jq -r '.files[]?.fileId')

  request="$(jq -nc --arg a "${B2_ACCOUNT}" --arg b "${bucket}" \
    '{accountId: $a, bucketId: $b}')"
  b2 b2_delete_bucket "${request}" | jq -e '.bucketId' >/dev/null
}

reset_b2_buckets() {
  local name id
  step "Delete B2 raw bucket and its files"
  b2_authorize
  while IFS= read -r name; do
    [[ "${name}" != "${STATE_BUCKET}" ]] || continue
    id="$(b2_bucket_id "${name}")"
    [[ -n "${id}" ]] || continue
    act "${name} (with all files)" delete_bucket "${id}"
  done < <(names b2-bucket)
}

# Deletes the B2 application key with id $1.
delete_b2_key() {
  b2 b2_delete_key "$(jq -nc --arg i "$1" '{applicationKeyId: $i}')" \
    | jq -e '.applicationKeyId' >/dev/null
}

reset_b2_keys() {
  local request existing name id
  step "Delete B2 application key"
  request="$(jq -nc --arg a "${B2_ACCOUNT}" \
    '{accountId: $a, maxKeyCount: 1000}')"
  existing="$(b2 b2_list_keys "${request}" \
    | jq -r '.keys[]? | "\(.keyName) \(.applicationKeyId)"')"
  while IFS= read -r name; do
    while IFS= read -r id; do
      act "${name}" delete_b2_key "${id}"
    done < <(id_of "${name}" <<<"${existing}")
  done < <(names b2-key)
}

# Deletes the Aura instance with id $1.
delete_aura_instance() {
  curl -sS -f -o /dev/null -X DELETE \
    -H "Authorization: Bearer ${AURA_TOKEN}" \
    "${AURA_API}/v1/instances/$1"
}

reset_neo4j() {
  local existing name id
  step "Delete Neo4j Aura instance"
  aura_authorize
  existing="$(curl -sS -H "Authorization: Bearer ${AURA_TOKEN}" \
    "${AURA_API}/v1/instances" \
    | jq -r '.data[]? | "\(.name) \(.id)"')"
  while IFS= read -r name; do
    while IFS= read -r id; do
      act "${name} (${id})" delete_aura_instance "${id}"
    done < <(id_of "${name}" <<<"${existing}")
  done < <(names neo4j)
}

# Hides the state file in bucket id $1; a hidden B2 file (delete marker)
# reads as an empty state, and earlier versions stay for recovery.
hide_state() {
  local request
  request="$(jq -nc --arg b "$1" --arg n "${STATE_KEY}" \
    '{bucketId: $b, fileName: $n}')"
  b2 b2_hide_file "${request}" | jq -e '.action == "hide"' >/dev/null
}

reset_state() {
  local bucket_id request
  local action=""
  step "Reset deployment state"
  bucket_id="$(b2_bucket_id "${STATE_BUCKET}")"
  if [[ -n "${bucket_id}" ]]; then
    request="$(jq -nc --arg b "${bucket_id}" --arg n "${STATE_KEY}" \
      '{bucketId: $b, startFileName: $n, maxFileCount: 1}')"
    action="$(b2 b2_list_file_names "${request}" \
      | jq -r --arg n "${STATE_KEY}" \
        '.files[0]? | select(.fileName == $n) | .action')"
  fi

  if [[ "${action}" != upload ]]; then
    note "${DIM}" "– already empty"
  elif ((failure_count > 0)) && [[ "${DRY_RUN}" == false ]]; then
    note "${YELLOW}" "! kept: some deletions failed; rerun after fixing them"
  else
    act "state file (earlier versions kept)" hide_state "${bucket_id}"
  fi
}

#######################################
# Prints the totals and exits 1 if any deletion failed.
# Globals:
#   DRY_RUN deleted_count planned_count failure_count SECONDS
# Arguments:
#   None
#######################################
print_summary() {
  step_end
  printf '\n%sSummary%s  %s(%ds)%s\n' "${BOLD}" "${RESET}" "${DIM}" \
    "${SECONDS}" "${RESET}"
  if [[ "${DRY_RUN}" == true ]]; then
    printf '  %s○ %d to delete%s\n' "${YELLOW}" "${planned_count}" \
      "${RESET}"
    printf '\n%sDry run: nothing was deleted.%s' "${YELLOW}${BOLD}" \
      "${RESET}"
    printf ' Run without --dry-run to delete.\n'
    return 0
  fi
  printf '  %s✓ %d deleted%s\n' "${GREEN}" "${deleted_count}" "${RESET}"
  if ((failure_count > 0)); then
    printf '  %s✗ %d failed%s\n' "${RED}${BOLD}" "${failure_count}" \
      "${RESET}"
    printf '\n%sFinished with failures.%s' "${RED}${BOLD}" "${RESET}"
    printf ' Fix them and rerun (the script is idempotent).\n'
    exit 1
  fi
  printf '\n%sDone.%s The next deploy recreates everything.\n' \
    "${GREEN}${BOLD}" "${RESET}"
}

main() {
  setup_colors
  parse_args "$@"
  load_config
  print_banner
  confirm

  reset_pages
  reset_workers
  reset_listed "Delete queues" queue /queues \
    '"\(.queue_name) \(.queue_id)"'
  reset_listed "Delete D1 databases" d1 /d1/database '"\(.name) \(.uuid)"'
  reset_listed "Delete KV namespaces" kv /storage/kv/namespaces \
    '"\(.title) \(.id)"'
  reset_vectorize
  reset_b2_buckets
  reset_b2_keys
  reset_neo4j
  reset_state

  print_summary
}

main "$@"
