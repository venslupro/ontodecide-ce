#!/usr/bin/env bash
#
# Deletes every deployed OntoDecide CE V2.4 resource and service so the
# next Terraform + Deploy run starts from zero. Irreversible: all workspace
# data and archives are lost. Never run by CI. V1.3 leftovers are deleted by
# scripts/cleanup_legacy.sh.
#
#   scripts/reset.sh [--dry-run] [--yes] [--domain example.com]
#                    [--env-file FILE]
#
#   --dry-run  Only list what would be deleted.
#   --yes      Skip the confirmation prompt.
#   --domain   The APP_DOMAIN in use (default: $APP_DOMAIN). Also deletes the
#              zone records and rules Terraform created there (app CNAME,
#              apex 100:: placeholder, _dmarc, mail records listed in
#              $MAIL_DNS_RECORDS, redirect and rate-limit rulesets) and the
#              pages.dev bulk redirect. Zone settings are left unchanged.
#   --env-file Local credentials file (default .env.local), relative to the
#              current directory.
#
# Output is colored on a terminal; NO_COLOR=1 turns colors off and
# FORCE_COLOR=1 keeps them when piped.
#
# Deleted, in dependency order: Pages project (with its custom domain),
# 7 Workers, 2 queues, 5 D1 databases, B2 archive bucket (emptied first)
# and its keys, Turnstile widget, zone records and rules, then the
# Terraform state file (earlier versions are kept).
#
# Requires curl, jq and, from the credentials file (KEY=value lines,
# chmod 600) or the environment:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY      (B2 master key)
# The CI secret names (CF_API_TOKEN, B2_MASTER_KEY, …) are accepted too.

set -euo pipefail

# shellcheck source=scripts/lib/cloud.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/cloud.sh"

readonly PROJECT="ontodecide"
readonly ENVIRONMENT="prd"
readonly PREFIX="${PROJECT}-${ENVIRONMENT}"
readonly PAGES_PROJECT="ontodecide-ce" # exempt from the naming rule
readonly STATE_BUCKET="ontodecide-ce-tfstate"
readonly STATE_KEY="terraform.tfstate" # infra/versions.tf backend key
readonly TOTAL_STEPS=10

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

DOMAIN="${APP_DOMAIN:-}"

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --dry-run) DRY_RUN=true ;;
      --yes) ASSUME_YES=true ;;
      --domain | --env-file)
        if (($# < 2)); then
          err "$1 needs a value"
          exit 2
        fi
        if [[ "$1" == --domain ]]; then DOMAIN="$2"; else ENV_FILE="$2"; fi
        shift
        ;;
      -h | --help)
        usage "$0"
        exit 0
        ;;
      *)
        err "unknown option: $1 (see --help)"
        exit 2
        ;;
    esac
    shift
  done
  readonly DRY_RUN ASSUME_YES ENV_FILE DOMAIN
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
  for name in "${WORKERS[@]}"; do
    grep -qxF "${PREFIX}-${name}" <<<"${existing}" || continue
    act "${PREFIX}-${name}" delete_worker "${PREFIX}-${name}"
  done
}

reset_queues() {
  local existing name id
  step "Delete queues"
  existing="$(cf_list /queues '"\(.queue_name) \(.queue_id)"')"
  for name in "${QUEUES[@]}"; do
    id="$(id_of "${PREFIX}-${name}" <<<"${existing}")"
    [[ -z "${id}" ]] || act "${PREFIX}-${name}" delete_queue "${id}"
  done
}

reset_d1() {
  local existing name id
  step "Delete D1 databases"
  existing="$(cf_list /d1/database '"\(.name) \(.uuid)"')"
  for name in "${D1_SERVICES[@]}"; do
    id="$(id_of "${PREFIX}-${name}-db" <<<"${existing}")"
    [[ -z "${id}" ]] \
      || act "${PREFIX}-${name}-db" cf_ok DELETE "/d1/database/${id}"
  done
}

reset_b2_bucket() {
  local id
  step "Delete B2 archive bucket and its files"
  b2_authorize
  id="$(b2_bucket_id "${PREFIX}-archive")"
  [[ -z "${id}" ]] \
    || act "${PREFIX}-archive (with all files)" b2_delete_bucket "${id}"
}

reset_b2_keys() {
  local existing name id
  step "Delete B2 application keys"
  existing="$(b2_keys)"
  for name in "${B2_KEYS[@]}"; do
    while IFS= read -r id; do
      act "${PREFIX}-${name}" b2_delete_key "${id}"
    done < <(id_of "${PREFIX}-${name}" <<<"${existing}")
  done
}

reset_turnstile() {
  local sitekey
  step "Delete Turnstile widget"
  while IFS= read -r sitekey; do
    [[ -n "${sitekey}" ]] || continue
    act "${PREFIX}-auth (${sitekey})" cf_ok DELETE \
      "/challenges/widgets/${sitekey}"
  done < <(cf_list /challenges/widgets \
    "select(.name == \"${PREFIX}-auth\") | .sitekey")
}

#######################################
# Deletes the DNS records of one name/type (and content, if given).
# Arguments:
#   Zone id, FQDN, type, optional content filter.
#######################################
delete_records() {
  local zone="$1"
  local name="$2"
  local type="$3"
  local content="${4:-}"
  local id
  while IFS= read -r id; do
    [[ -n "${id}" ]] || continue
    act "${type} ${name}" cf_zone_ok DELETE "${zone}" "/dns_records/${id}"
  done < <(cf_zone GET "${zone}" "/dns_records?name=${name}&type=${type}" \
    | jq -r --arg c "${content}" \
      '.result[]? | select($c == "" or .content == $c) | .id')
}

reset_zone() {
  local zone name id fqdn list_id
  step "Delete zone records, rules and the pages.dev redirect"
  if [[ -z "${DOMAIN}" ]]; then
    note "${DIM}" "– no domain (--domain / APP_DOMAIN)"
    return 0
  fi
  zone="$(curl -sS -H "Authorization: Bearer ${CF_TOKEN}" \
    "${CF_API}/zones?name=${DOMAIN}" | jq -r '.result[0]?.id // empty')"
  if [[ -z "${zone}" ]]; then
    warn "zone ${DOMAIN} not found in the account"
  else
    delete_records "${zone}" "app.${DOMAIN}" CNAME
    delete_records "${zone}" "${DOMAIN}" AAAA "100::"
    delete_records "${zone}" "_dmarc.${DOMAIN}" TXT
    while IFS=$'\t' read -r name type; do
      [[ -n "${name}" ]] || continue
      case "${name}" in
        "@") fqdn="${DOMAIN}" ;;
        *"${DOMAIN}") fqdn="${name}" ;;
        *) fqdn="${name}.${DOMAIN}" ;;
      esac
      delete_records "${zone}" "${fqdn}" "${type}"
    done < <(jq -r '.[]? | "\(.name)\t\(.type)"' \
      <<<"${MAIL_DNS_RECORDS:-[]}")
    while IFS= read -r id; do
      [[ -n "${id}" ]] || continue
      act "zone ruleset ${id}" cf_zone_ok DELETE "${zone}" "/rulesets/${id}"
    done < <(cf_zone GET "${zone}" /rulesets | jq -r \
      --arg a "${PREFIX}-apex-redirect" --arg b "${PREFIX}-api-rate-limit" \
      '.result[]? | select(.name == $a or .name == $b) | .id')
  fi
  while IFS= read -r id; do
    [[ -n "${id}" ]] || continue
    act "account ruleset ${PREFIX}-pages-redirect" cf_ok DELETE \
      "/rulesets/${id}"
  done < <(cf GET /rulesets | jq -r --arg n "${PREFIX}-pages-redirect" \
    '.result[]? | select(.name == $n) | .id')
  list_id="$(cf GET /rules/lists | jq -r \
    --arg n "${PREFIX//-/_}_pages_redirect" \
    '.result[]? | select(.name == $n) | .id')"
  [[ -z "${list_id}" ]] \
    || act "list ${PREFIX//-/_}_pages_redirect" cf_ok DELETE \
      "/rules/lists/${list_id}"
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
  step "Reset Terraform state"
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

main() {
  setup_colors
  parse_args "$@"
  load_config cf b2
  print_banner "OntoDecide reset" "${PREFIX}${DOMAIN:+ + zone ${DOMAIN}}"
  confirm "${PREFIX}" "all ${PREFIX} resources, services and data"

  reset_pages
  reset_workers
  reset_queues
  reset_d1
  reset_b2_bucket
  reset_b2_keys
  reset_turnstile
  reset_zone
  reset_state
  step "V1.3 leftovers"
  note "${DIM}" "– run scripts/cleanup_legacy.sh if V1.3 was ever deployed"

  print_summary "The next Terraform + Deploy run recreates everything."
}

main "$@"
