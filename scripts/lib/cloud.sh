#!/usr/bin/env bash
#
# Shared helpers for scripts/reset.sh and scripts/cleanup_legacy.sh:
# colored step output, dry-run aware deletion, Cloudflare / Backblaze B2 /
# Neo4j Aura API calls. Sourced, never executed.
#
# The sourcing script sets TOTAL_STEPS, parses its options into DRY_RUN,
# ASSUME_YES and ENV_FILE, then calls load_config with the credential
# groups it needs.

readonly CF_API="https://api.cloudflare.com/client/v4"
readonly AURA_API="https://api.neo4j.io"

DRY_RUN=false
ASSUME_YES=false
ENV_FILE=".env.local"

# Progress counters, updated by step() and act().
step_num=0
step_items=0
deleted_count=0
planned_count=0
failure_count=0

#######################################
# Sets the color codes: on a terminal or with FORCE_COLOR, never with
# NO_COLOR (https://no-color.org).
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

# Prints the header comment of script $1 as help text.
usage() {
  awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' \
    "$1"
}

#######################################
# Loads the credentials file (if any) and checks the required groups.
# Arguments:
#   Credential groups: cf, b2, aura.
# Globals:
#   CONFIG_SOURCE CF_TOKEN CF_ACCOUNT B2_ID B2_KEY AURA_ID AURA_SECRET (set)
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

  local -a missing=()
  local group pair var bin item
  local -a pairs
  for group in "$@"; do
    case "${group}" in
      cf) pairs=(CF_TOKEN:CLOUDFLARE_API_TOKEN CF_ACCOUNT:CLOUDFLARE_ACCOUNT_ID) ;;
      b2) pairs=(B2_ID:B2_APPLICATION_KEY_ID B2_KEY:B2_APPLICATION_KEY) ;;
      aura) pairs=(AURA_ID:AURA_CLIENT_ID AURA_SECRET:AURA_CLIENT_SECRET) ;;
      *) pairs=() ;;
    esac
    for pair in "${pairs[@]}"; do
      var="${pair%%:*}"
      [[ -n "${!var}" ]] || missing+=("${pair#*:}")
    done
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
# Arguments:
#   Resource description, then the command and its arguments.
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

# Asks for the word $1 before a live run unless --yes; exits 1 otherwise.
confirm() {
  local word="$1"
  local what="$2"
  local answer
  [[ "${DRY_RUN}" == false && "${ASSUME_YES}" == false ]] || return 0
  printf '\n%sThis permanently deletes %s.%s\n' "${RED}${BOLD}" "${what}" \
    "${RESET}"
  read -r -p "Type ${word} to continue: " answer
  if [[ "${answer}" != "${word}" ]]; then
    warn "aborted; nothing was deleted"
    exit 1
  fi
}

# Prints the title, target, mode and config source.
print_banner() {
  printf '%s%s%s\n' "${BOLD}" "$1" "${RESET}"
  printf '  %starget%s   %s\n' "${DIM}" "${RESET}" "$2"
  if [[ "${DRY_RUN}" == true ]]; then
    printf '  %smode%s     %sdry run%s (nothing is deleted)\n' \
      "${DIM}" "${RESET}" "${YELLOW}${BOLD}" "${RESET}"
  else
    printf '  %smode%s     %sLIVE%s (resources are deleted)\n' \
      "${DIM}" "${RESET}" "${RED}${BOLD}" "${RESET}"
  fi
  printf '  %sconfig%s   %s\n' "${DIM}" "${RESET}" "${CONFIG_SOURCE}"
}

#######################################
# Prints the totals and exits 1 if any deletion failed.
# Arguments:
#   Message printed on success.
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
  printf '\n%sDone.%s %s\n' "${GREEN}${BOLD}" "${RESET}" "$1"
}

# ---- Cloudflare -----------------------------------------------------------

# Calls the Cloudflare account API: cf METHOD PATH [JSON]; prints the body.
cf() {
  local -a data=()
  [[ -z "${3:-}" ]] || data=(-H 'Content-Type: application/json' -d "$3")
  curl -sS -X "$1" -H "Authorization: Bearer ${CF_TOKEN}" "${data[@]}" \
    "${CF_API}/accounts/${CF_ACCOUNT}$2"
}

# Calls the Cloudflare zone API: cf_zone METHOD ZONE_ID PATH.
cf_zone() {
  curl -sS -X "$1" -H "Authorization: Bearer ${CF_TOKEN}" \
    "${CF_API}/zones/$2$3"
}

# Succeeds if the Cloudflare call cf METHOD PATH reports success.
cf_ok() {
  cf "$@" | jq -e '.success == true' >/dev/null
}

# Succeeds if cf_zone METHOD ZONE_ID PATH reports success.
cf_zone_ok() {
  cf_zone "$@" | jq -e '.success == true' >/dev/null
}

#######################################
# Prints a jq filter over every page of a Cloudflare account collection.
# Arguments:
#   Collection path, jq filter applied to each item.
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

# Deletes Worker script $1 (bindings to it are gone once callers are gone).
delete_worker() {
  cf_ok DELETE "/workers/scripts/$1?force=true"
}

# Prints the id of queue $1, or nothing.
queue_id() {
  cf_list /queues '"\(.queue_name) \(.queue_id)"' | id_of "$1"
}

# Deletes queue id $1 after removing its consumers.
delete_queue() {
  local id="$1"
  local consumer
  while IFS= read -r consumer; do
    [[ -n "${consumer}" ]] || continue
    cf DELETE "/queues/${id}/consumers/${consumer}" >/dev/null
  done < <(cf GET "/queues/${id}/consumers" \
    | jq -r '.result[]?.consumer_id // empty')
  cf_ok DELETE "/queues/${id}"
}

# ---- Backblaze B2 ---------------------------------------------------------

# Calls the Backblaze B2 native API: b2 CALL JSON; prints the JSON body.
b2() {
  curl -sS -H "Authorization: ${B2_TOKEN}" -d "$2" \
    "${B2_API}/b2api/v3/$1"
}

# Authorizes the B2 master key (sets B2_TOKEN B2_API B2_ACCOUNT).
b2_authorize() {
  [[ -z "${B2_TOKEN:-}" ]] || return 0
  local auth
  auth="$(curl -sS -u "${B2_ID}:${B2_KEY}" \
    https://api.backblazeb2.com/b2api/v3/b2_authorize_account)"
  B2_TOKEN="$(jq -r '.authorizationToken // empty' <<<"${auth}")"
  B2_API="$(jq -r '.apiInfo.storageApi.apiUrl // empty' <<<"${auth}")"
  B2_ACCOUNT="$(jq -r '.accountId // empty' <<<"${auth}")"
  if [[ -z "${B2_TOKEN}" ]]; then
    err "B2 authorization failed" \
      "(check B2_APPLICATION_KEY_ID / B2_APPLICATION_KEY)"
    exit 1
  fi
}

# Prints the id of B2 bucket $1, or nothing if it does not exist.
b2_bucket_id() {
  local request
  request="$(jq -nc --arg a "${B2_ACCOUNT}" --arg n "$1" \
    '{accountId: $a, bucketName: $n}')"
  b2 b2_list_buckets "${request}" | jq -r '.buckets[0]?.bucketId // empty'
}

#######################################
# Deletes every file version and unfinished upload of a B2 bucket, then
# the bucket.
# Arguments:
#   Bucket id.
#######################################
b2_delete_bucket() {
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

# Prints "keyName keyId" for every B2 application key.
b2_keys() {
  b2 b2_list_keys "$(jq -nc --arg a "${B2_ACCOUNT}" \
    '{accountId: $a, maxKeyCount: 1000}')" \
    | jq -r '.keys[]? | "\(.keyName) \(.applicationKeyId)"'
}

# Deletes the B2 application key with id $1.
b2_delete_key() {
  b2 b2_delete_key "$(jq -nc --arg i "$1" '{applicationKeyId: $i}')" \
    | jq -e '.applicationKeyId' >/dev/null
}

# ---- Neo4j Aura -----------------------------------------------------------

# Authorizes the Aura API client (sets AURA_TOKEN).
aura_authorize() {
  AURA_TOKEN="$(curl -sS -u "${AURA_ID}:${AURA_SECRET}" \
    -d grant_type=client_credentials "${AURA_API}/oauth/token" \
    | jq -r '.access_token // empty')"
  if [[ -z "${AURA_TOKEN}" ]]; then
    err "Aura authorization failed" \
      "(check AURA_CLIENT_ID / AURA_CLIENT_SECRET)"
    exit 1
  fi
}

# Prints "name id" for every Aura instance.
aura_instances() {
  curl -sS -H "Authorization: Bearer ${AURA_TOKEN}" \
    "${AURA_API}/v1/instances" | jq -r '.data[]? | "\(.name) \(.id)"'
}

# Deletes the Aura instance with id $1.
aura_delete_instance() {
  curl -sS -f -o /dev/null -X DELETE \
    -H "Authorization: Bearer ${AURA_TOKEN}" \
    "${AURA_API}/v1/instances/$1"
}
