#!/usr/bin/env bash
#
# Deletes every deployed OntoDecide CE V2.4 resource and service so the
# next Terraform + Deploy run starts from zero. Irreversible: all workspace
# data and archives are lost. Never run by CI. V1.3 leftovers are deleted by
# scripts/cleanup_legacy.sh.
#
#   scripts/reset.sh [--dry-run] [--yes] [--env-file FILE]
#
#   --dry-run  Only list what would be deleted.
#   --yes      Skip the confirmation prompt.
#   --env-file Credentials file (default .env.local), relative to the
#              current directory.
#
# The apex domain's DNS stays with its registrar (NameSilo); there is no
# Cloudflare zone, so this script does not touch zone-level DNS records or
# Workers Routes. Custom domains attached to the Pages project are read
# from the Cloudflare API automatically; no --domain flag is needed.
#
# Deleted, in dependency order (names as in infra/*.tf and
# apps/*/wrangler.jsonc.tpl, prefix ontodecide-prd):
#   Wrangler:  7 Workers (with their Durable Objects, crons and secrets)
#   Terraform: 2 queues, 5 D1 databases, B2 archive bucket (emptied first)
#              and its 3 keys, Turnstile widget, and the account-level
#              pages.dev bulk redirect (list + ruleset) when the Pages
#              project has custom domains
#   Wrangler:  Pages project ontodecide-ce (custom domains deleted first,
#              then the project itself)
# A live run then lists everything again to verify nothing is left, and
# only then hides the Terraform state file (earlier versions are kept).
# If anything cannot be listed or deleted, the state is kept; fix it and
# rerun (the script is idempotent).
#
# Self-contained; runs with macOS /bin/bash (3.2). Requires curl, jq and,
# from the credentials file (KEY=value lines, chmod 600) or the
# environment:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID  (the CI deploy token)
#   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY    (B2 master key)
# The CI secret names (CF_API_TOKEN, B2_MASTER_KEY, …) are accepted too.
#
# Output is colored on a terminal; NO_COLOR=1 turns colors off and
# FORCE_COLOR=1 keeps them when piped.

set -euo pipefail

readonly PROJECT="ontodecide"
readonly ENVIRONMENT="prd"
readonly PREFIX="${PROJECT}-${ENVIRONMENT}"
readonly PAGES_PROJECT="ontodecide-ce" # exempt from the naming rule
readonly STATE_BUCKET="ontodecide-ce-tfstate"
readonly STATE_KEY="terraform.tfstate" # infra/versions.tf backend key
readonly TOTAL_STEPS=10
readonly CF_API="https://api.cloudflare.com/client/v4"

readonly -a D1_SERVICES=(
  identity-access ontology-manager data-integration object-graph
  decision-engine
)
# Root → leaf, so no Worker is deleted while another still binds to it.
readonly -a WORKERS=(
  api-gateway identity-access data-integration decision-engine
  situation-awareness object-graph ontology-manager
)
readonly -a QUEUES=(domain-events dead-letter)
readonly -a B2_KEYS=(archive-write archive-sign-a archive-sign-b)

DRY_RUN=false
ASSUME_YES=false
ENV_FILE=".env.local"

# delete: normal run; verify: the second pass, where every resource still
# found is a failure.
MODE=delete

# Custom domains attached to the Pages project, fetched from the Cloudflare
# API in reset_pages(). Used by reset_redirect() to decide whether the
# account-level pages.dev bulk redirect exists.
PAGES_CUSTOM_DOMAINS=""

# Progress counters, updated by step() and act().
step_num=0
step_items=0
deleted_count=0
planned_count=0
failure_count=0

# ---- Output ---------------------------------------------------------------

# Sets the color codes: on a terminal or with FORCE_COLOR, never with
# NO_COLOR (https://no-color.org).
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

# Prints the header comment of this script as help text.
usage() {
  awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' \
    "$0"
}

# Closes the current step, noting when it found nothing.
step_end() {
  if [[ "${MODE}" == delete ]] && ((step_num > 0 && step_items == 0)); then
    printf '  %s– nothing to delete%s\n' "${DIM}" "${RESET}"
  fi
}

# Starts the next numbered step, titled $1 (silent while verifying).
step() {
  [[ "${MODE}" == delete ]] || return 0
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
# Deletes one resource by running a command, unless --dry-run. While
# verifying, only reports that the resource still exists.
# Arguments:
#   Resource description, then the command and its arguments.
#######################################
act() {
  local what="$1"
  shift
  ((step_items += 1))
  if [[ "${MODE}" == verify ]]; then
    printf '  %s✗ still exists%s %s\n' "${RED}${BOLD}" "${RESET}" \
      "${what}" >&2
    ((failure_count += 1))
  elif [[ "${DRY_RUN}" == true ]]; then
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

# Records that resources $1 could not be listed (the error is on STDERR);
# they are kept, and so is the Terraform state.
list_failed() {
  note "${RED}${BOLD}" "✗ could not list $1; nothing deleted here"
  ((failure_count += 1))
}

# ---- Configuration --------------------------------------------------------

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --dry-run) DRY_RUN=true ;;
      --yes) ASSUME_YES=true ;;
      --env-file)
        if (($# < 2)); then
          err "$1 needs a value"
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
  readonly DRY_RUN ASSUME_YES ENV_FILE
}

#######################################
# Loads the credentials file (if any) and checks the credentials.
# Globals:
#   CONFIG_SOURCE CF_TOKEN CF_ACCOUNT B2_ID B2_KEY (set)
#######################################
load_config() {
  local var bin item
  local -a missing=()
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

  for var in CF_TOKEN:CLOUDFLARE_API_TOKEN CF_ACCOUNT:CLOUDFLARE_ACCOUNT_ID \
    B2_ID:B2_APPLICATION_KEY_ID B2_KEY:B2_APPLICATION_KEY; do
    item="${var%%:*}"
    [[ -n "${!item}" ]] || missing+=("${var#*:}")
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

# Asks for the prefix before a live run unless --yes; exits 1 otherwise.
confirm() {
  local answer
  [[ "${DRY_RUN}" == false && "${ASSUME_YES}" == false ]] || return 0
  printf '\n%sThis permanently deletes all %s resources, services and data.%s\n' \
    "${RED}${BOLD}" "${PREFIX}" "${RESET}"
  read -r -p "Type ${PREFIX} to continue: " answer
  if [[ "${answer}" != "${PREFIX}" ]]; then
    warn "aborted; nothing was deleted"
    exit 1
  fi
}

# Prints the title, target, mode and config source.
print_banner() {
  printf '%sOntoDecide reset%s\n' "${BOLD}" "${RESET}"
  printf '  %starget%s   %s\n' "${DIM}" "${RESET}" "${PREFIX}"
  if [[ "${DRY_RUN}" == true ]]; then
    printf '  %smode%s     %sdry run%s (nothing is deleted)\n' \
      "${DIM}" "${RESET}" "${YELLOW}${BOLD}" "${RESET}"
  else
    printf '  %smode%s     %sLIVE%s (resources are deleted)\n' \
      "${DIM}" "${RESET}" "${RED}${BOLD}" "${RESET}"
  fi
  printf '  %sconfig%s   %s\n' "${DIM}" "${RESET}" "${CONFIG_SOURCE}"
}

# Prints the totals; exits 1 if anything failed or is left.
print_summary() {
  step_end
  printf '\n%sSummary%s  %s(%ds)%s\n' "${BOLD}" "${RESET}" "${DIM}" \
    "${SECONDS}" "${RESET}"
  if [[ "${DRY_RUN}" == true ]]; then
    printf '  %s○ %d to delete%s\n' "${YELLOW}" "${planned_count}" "${RESET}"
  else
    printf '  %s✓ %d deleted%s\n' "${GREEN}" "${deleted_count}" "${RESET}"
  fi
  if ((failure_count > 0)); then
    printf '  %s✗ %d failed, left or not checked%s\n' "${RED}${BOLD}" \
      "${failure_count}" "${RESET}"
    printf '\n%sFinished with failures.%s' "${RED}${BOLD}" "${RESET}"
    printf ' Fix them and rerun (the script is idempotent).\n'
    exit 1
  fi
  if [[ "${DRY_RUN}" == true ]]; then
    printf '\n%sDry run: nothing was deleted.%s' "${YELLOW}${BOLD}" "${RESET}"
    printf ' Run without --dry-run to delete.\n'
  else
    printf '\n%sDone.%s Nothing is left; the next Terraform + Deploy run' \
      "${GREEN}${BOLD}" "${RESET}"
    printf ' recreates everything.\n'
  fi
}

# ---- Cloudflare -----------------------------------------------------------

# Calls the Cloudflare account API: cf METHOD PATH; prints the body.
cf() {
  curl -sS -X "$1" -H "Authorization: Bearer ${CF_TOKEN}" \
    "${CF_API}/accounts/${CF_ACCOUNT}$2"
}

#######################################
# Prints Cloudflare response body $2 of call $1 if it reports success;
# otherwise prints the API errors to STDERR and fails, so a missing token
# permission is never mistaken for "nothing to delete".
#######################################
cf_checked() {
  local messages
  if jq -e '.success == true' >/dev/null 2>&1 <<<"$2"; then
    printf '%s\n' "$2"
    return 0
  fi
  messages="$(jq -r '(.errors // []) | map(.message) | join("; ")' \
    2>/dev/null <<<"$2" || true)"
  err "$1: ${messages:-no valid response}"
  return 1
}

# Prints the body of GET PATH on the account API, or fails.
cf_get() {
  cf_checked "GET $1" "$(cf GET "$1")"
}

# Succeeds if the Cloudflare call cf METHOD PATH reports success; prints
# the API error to STDERR on failure.
cf_ok() {
  local body messages
  body="$(cf "$@")"
  if jq -e '.success == true' >/dev/null 2>&1 <<<"${body}"; then
    return 0
  fi
  messages="$(jq -r '(.errors // []) | map(.message) | join("; ")' \
    2>/dev/null <<<"${body}" || true)"
  err "$1 $2: ${messages:-no valid response}"
  return 1
}

#######################################
# Prints a jq filter over every page of a Cloudflare account collection;
# fails if a page cannot be read.
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
    body="$(cf_get "${path}${sep}page=${page}&per_page=100")" || return 1
    jq -r ".result[]? | ${filter}" <<<"${body}"
    (($(jq '.result | length' <<<"${body}") < 100)) && break
    ((page += 1))
  done
}

# Prints the ids of name $1 from "name id" lines on STDIN.
id_of() {
  awk -v n="$1" '$1 == n { print $2 }'
}

# ---- Backblaze B2 ---------------------------------------------------------

# Calls the Backblaze B2 native API: b2 CALL JSON; prints the JSON body.
b2() {
  curl -sS -H "Authorization: ${B2_TOKEN}" -d "$2" "${B2_API}/b2api/v3/$1"
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

# Prints B2 response body $2 of call $1 if it has field $3; otherwise
# prints the B2 error to STDERR and fails.
b2_checked() {
  if jq -e --arg f "$3" 'has($f)' >/dev/null 2>&1 <<<"$2"; then
    printf '%s\n' "$2"
    return 0
  fi
  err "$1: $(jq -r '.message // empty' 2>/dev/null <<<"$2" || true)"
  return 1
}

# Prints the id of B2 bucket $1, nothing if it does not exist, or fails.
b2_bucket_id() {
  local request body
  request="$(jq -nc --arg a "${B2_ACCOUNT}" --arg n "$1" \
    '{accountId: $a, bucketName: $n}')"
  body="$(b2_checked b2_list_buckets \
    "$(b2 b2_list_buckets "${request}")" buckets)" || return 1
  jq -r '.buckets[0]?.bucketId // empty' <<<"${body}"
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
    body="$(b2_checked b2_list_file_versions \
      "$(b2 b2_list_file_versions "${request}")" files)" || return 1
    while IFS= read -r file; do
      [[ -n "${file}" ]] || continue
      b2 b2_delete_file_version \
        "$(jq -c '. + {bypassGovernance: true}' <<<"${file}")" >/dev/null
    done < <(jq -c '.files[] | {fileName, fileId}' <<<"${body}")
    next_name="$(jq -r '.nextFileName // empty' <<<"${body}")"
    next_id="$(jq -r '.nextFileId // empty' <<<"${body}")"
    [[ -n "${next_name}" ]] || break
  done

  request="$(jq -nc --arg b "${bucket}" '{bucketId: $b}')"
  while IFS= read -r id; do
    [[ -n "${id}" ]] || continue
    b2 b2_cancel_large_file "$(jq -nc --arg i "${id}" '{fileId: $i}')" \
      >/dev/null
  done < <(b2 b2_list_unfinished_large_files "${request}" \
    | jq -r '.files[]?.fileId')

  request="$(jq -nc --arg a "${B2_ACCOUNT}" --arg b "${bucket}" \
    '{accountId: $a, bucketId: $b}')"
  b2 b2_delete_bucket "${request}" | jq -e '.bucketId' >/dev/null
}

# Prints "keyName keyId" for every B2 application key, or fails.
b2_keys() {
  local body
  body="$(b2_checked b2_list_keys "$(b2 b2_list_keys \
    "$(jq -nc --arg a "${B2_ACCOUNT}" \
      '{accountId: $a, maxKeyCount: 1000}')")" keys)" || return 1
  jq -r '.keys[] | "\(.keyName) \(.applicationKeyId)"' <<<"${body}"
}

# Deletes the B2 application key with id $1.
b2_delete_key() {
  b2 b2_delete_key "$(jq -nc --arg i "$1" '{applicationKeyId: $i}')" \
    | jq -e '.applicationKeyId' >/dev/null
}

# ---- Resources ------------------------------------------------------------

#######################################
# Deletes the Pages project. A project with many deployments must be
# emptied first; each pass deletes one page of them and stops when a pass
# deletes nothing.
#######################################
delete_pages_project() {
  local path="/pages/projects/${PAGES_PROJECT}"
  local ids id deleted
  while true; do
    cf_ok DELETE "${path}" && return 0
    ids="$(cf_get "${path}/deployments?per_page=25" \
      | jq -r '.result[]?.id')" || return 1
    deleted=0
    while IFS= read -r id; do
      [[ -n "${id}" ]] || continue
      if cf_ok DELETE "${path}/deployments/${id}?force=true"; then
        ((deleted += 1))
      fi
    done <<<"${ids}"
    ((deleted > 0)) || return 1
  done
}

reset_pages() {
  local status domains domain
  step "Delete Pages custom domains and project"
  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${CF_TOKEN}" \
    "${CF_API}/accounts/${CF_ACCOUNT}/pages/projects/${PAGES_PROJECT}")"
  case "${status}" in
    200)
      # Custom domains must be detached before the project can be
      # deleted. The project's own *.pages.dev domain is part of the
      # project and cannot be removed, so it is skipped.
      PAGES_CUSTOM_DOMAINS=""
      if domains="$(cf_list "/pages/projects/${PAGES_PROJECT}/domains" \
        '.name')"; then
        while IFS= read -r domain; do
          [[ -n "${domain}" ]] || continue
          [[ "${domain}" == *.pages.dev ]] && continue
          PAGES_CUSTOM_DOMAINS="${PAGES_CUSTOM_DOMAINS}${domain}"$'\n'
          act "Pages domain ${domain}" cf_ok DELETE \
            "/pages/projects/${PAGES_PROJECT}/domains/${domain}"
        done <<<"${domains}"
      else
        list_failed "Pages custom domains"
      fi
      act "Pages project ${PAGES_PROJECT}" delete_pages_project ;;
    404) ;;
    *)
      err "GET Pages project ${PAGES_PROJECT}: HTTP ${status}"
      list_failed "the Pages project"
      ;;
  esac
}

# Deletes Worker script $1 with its Durable Objects (force: bindings to it
# are gone once its callers are gone).
delete_worker() {
  cf_ok DELETE "/workers/scripts/$1?force=true"
}

reset_workers() {
  local existing name
  step "Delete Workers"
  if ! existing="$(cf_get /workers/scripts | jq -r '.result[]?.id')"; then
    list_failed "Workers"
    return 0
  fi
  for name in "${WORKERS[@]}"; do
    grep -qxF "${PREFIX}-${name}" <<<"${existing}" || continue
    act "Worker ${PREFIX}-${name}" delete_worker "${PREFIX}-${name}"
  done
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

reset_queues() {
  local existing name id
  step "Delete queues"
  if ! existing="$(cf_list /queues '"\(.queue_name) \(.queue_id)"')"; then
    list_failed "queues"
    return 0
  fi
  for name in "${QUEUES[@]}"; do
    id="$(id_of "${PREFIX}-${name}" <<<"${existing}")"
    [[ -z "${id}" ]] || act "queue ${PREFIX}-${name}" delete_queue "${id}"
  done
}

reset_d1() {
  local existing name id
  step "Delete D1 databases"
  if ! existing="$(cf_list /d1/database '"\(.name) \(.uuid)"')"; then
    list_failed "D1 databases"
    return 0
  fi
  for name in "${D1_SERVICES[@]}"; do
    id="$(id_of "${PREFIX}-${name}-db" <<<"${existing}")"
    [[ -z "${id}" ]] \
      || act "D1 ${PREFIX}-${name}-db" cf_ok DELETE "/d1/database/${id}"
  done
}

reset_b2_bucket() {
  local id
  step "Delete B2 archive bucket and its files"
  b2_authorize
  if ! id="$(b2_bucket_id "${PREFIX}-archive")"; then
    list_failed "B2 buckets"
    return 0
  fi
  [[ -z "${id}" ]] \
    || act "B2 bucket ${PREFIX}-archive (with all files)" \
      b2_delete_bucket "${id}"
}

reset_b2_keys() {
  local existing name id
  step "Delete B2 application keys"
  if ! existing="$(b2_keys)"; then
    list_failed "B2 application keys"
    return 0
  fi
  for name in "${B2_KEYS[@]}"; do
    while IFS= read -r id; do
      [[ -n "${id}" ]] || continue
      act "B2 key ${PREFIX}-${name}" b2_delete_key "${id}"
    done < <(id_of "${PREFIX}-${name}" <<<"${existing}")
  done
}

reset_turnstile() {
  local sitekeys sitekey
  step "Delete Turnstile widget"
  if ! sitekeys="$(cf_list /challenges/widgets \
    "select(.name == \"${PREFIX}-auth\") | .sitekey")"; then
    list_failed "Turnstile widgets (token needs Account · Turnstile · Edit)"
    return 0
  fi
  while IFS= read -r sitekey; do
    [[ -n "${sitekey}" ]] || continue
    act "Turnstile ${PREFIX}-auth (${sitekey})" cf_ok DELETE \
      "/challenges/widgets/${sitekey}"
  done <<<"${sitekeys}"
}

reset_redirect() {
  local ids id list_id
  local list_name="${PREFIX//-/_}_pages_redirect"
  step "Delete the pages.dev bulk redirect"
  if [[ -z "${PAGES_CUSTOM_DOMAINS}" ]]; then
    [[ "${MODE}" == verify ]] || note "${DIM}" \
      "– Pages project has no custom domains"
    return 0
  fi
  # No Cloudflare zone (the apex DNS stays with its registrar), so there are
  # no zone-level DNS records or Workers Routes to clean up. Only the
  # account-level pages.dev → custom-domain bulk redirect (list + ruleset)
  # Terraform created is deleted here. The ruleset references the list, so
  # delete it first.
  if ids="$(cf_get /rulesets | jq -r --arg n "${PREFIX}-pages-redirect" \
    '.result[]? | select(.name == $n) | .id')"; then
    while IFS= read -r id; do
      [[ -n "${id}" ]] || continue
      act "account ruleset ${PREFIX}-pages-redirect" cf_ok DELETE \
        "/rulesets/${id}"
    done <<<"${ids}"
  else
    list_failed "account rulesets"
  fi
  if list_id="$(cf_get /rules/lists | jq -r --arg n "${list_name}" \
    '.result[]? | select(.name == $n) | .id')"; then
    [[ -z "${list_id}" ]] \
      || act "list ${list_name}" cf_ok DELETE "/rules/lists/${list_id}"
  else
    list_failed "account lists"
  fi
}

# Runs every deletion step (or, in verify mode, every check).
reset_all() {
  reset_pages
  reset_workers
  reset_queues
  reset_d1
  reset_b2_bucket
  reset_b2_keys
  reset_turnstile
  reset_redirect
}

# Lists everything again after a live run; each resource still found is a
# failure. Deletions are asynchronous in a few APIs, so it waits briefly.
verify() {
  step "Verify nothing is left"
  if [[ "${DRY_RUN}" == true ]]; then
    note "${DIM}" "– skipped in a dry run"
    return 0
  fi
  if ((failure_count > 0)); then
    note "${DIM}" "– skipped: something above failed"
    return 0
  fi
  sleep 5
  local before="${failure_count}"
  MODE=verify
  reset_all
  MODE=delete
  if ((failure_count == before)); then
    note "${GREEN}" "✓ none of the resources above exists any more"
  fi
}

# ---- Terraform state ------------------------------------------------------

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
  step "Reset Terraform state"
  if ! bucket_id="$(b2_bucket_id "${STATE_BUCKET}")"; then
    list_failed "the state bucket ${STATE_BUCKET}"
    return 0
  fi
  if [[ -n "${bucket_id}" ]]; then
    request="$(jq -nc --arg b "${bucket_id}" --arg n "${STATE_KEY}" \
      '{bucketId: $b, startFileName: $n, maxFileCount: 1}')"
    if ! action="$(b2_checked b2_list_file_names \
      "$(b2 b2_list_file_names "${request}")" files \
      | jq -r --arg n "${STATE_KEY}" \
        '.files[0]? | select(.fileName == $n) | .action')"; then
      list_failed "the state file"
      return 0
    fi
  fi

  if [[ "${action}" != upload ]]; then
    note "${DIM}" "– already empty"
  elif ((failure_count > 0)); then
    # Hiding it would make Terraform recreate resources that still exist.
    note "${YELLOW}" "! kept: something above failed; rerun after fixing it"
  else
    act "state file ${STATE_BUCKET}/${STATE_KEY} (earlier versions kept)" \
      hide_state "${bucket_id}"
  fi
}

main() {
  setup_colors
  parse_args "$@"
  load_config
  print_banner
  confirm

  reset_all
  verify
  reset_state

  print_summary
}

main "$@"
