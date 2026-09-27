#!/usr/bin/env bash
#
# Deletes the V1.3 resources that V2.4 no longer uses, after the V2.4
# rollout (Deploy workflow) has replaced every Worker. Terraform already
# released them from its state (infra/legacy.tf, destroy = false). Manual,
# idempotent, never run by CI.
#
#   scripts/cleanup_legacy.sh [--dry-run] [--yes] [--env-file FILE]
#
#   --dry-run  Only list what would be deleted.
#   --yes      Skip the confirmation prompt.
#   --env-file Local credentials file (default .env.local), relative to the
#              current directory.
#
# Deleted (prefix ontodecide-prd): V1.3 Worker secrets (JWT_SECRET,
# APPROVAL_SECRET, NEO4J_*, …); D1 situation-awareness-db; KV
# schema-cache and gateway-config; queues ingest, object-writes,
# graph-sync, situation-events, decision-jobs and their -dlq queues
# (consumers first); Vectorize index decision-cases-bge-m3; B2 bucket raw
# (emptied first) and key data-integration; Neo4j Aura instance graphdb.
# A resource still referenced by a deployed Worker's bindings is skipped.
#
# Afterwards remove the matching blocks from infra/legacy.tf (and the
# neo4jaura provider with the AURA_* settings).
#
# Requires curl, jq and, from the credentials file (KEY=value lines,
# chmod 600) or the environment:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY      (B2 master key)
#   AURA_CLIENT_ID, AURA_CLIENT_SECRET             (skipped when unset)
# The CI secret names (CF_API_TOKEN, B2_MASTER_KEY, …) are accepted too.

set -euo pipefail

# shellcheck source=scripts/lib/cloud.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/cloud.sh"

readonly PREFIX="ontodecide-prd"
readonly TOTAL_STEPS=8
readonly -a WORKERS=(
  api-gateway identity-access decision-engine situation-awareness
  object-graph data-integration ontology-manager
)
readonly -a LEGACY_QUEUES=(
  ingest object-writes graph-sync situation-events decision-jobs
)
# V1.3 Worker secrets that V2.4 no longer reads.
readonly -a LEGACY_SECRETS=(
  JWT_SECRET APPROVAL_SECRET WRITEBACK_SECRET CONNECTOR_ENC_KEY
  BOOTSTRAP_ADMIN_PASSWORD GEMINI_API_KEY GROQ_API_KEY B2_KEY_ID B2_APP_KEY
  NEO4J_URL NEO4J_USER NEO4J_PASSWORD
)

# JSON of every deployed Worker's bindings (filled by load_bindings).
BINDINGS=""

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --dry-run) DRY_RUN=true ;;
      --yes) ASSUME_YES=true ;;
      --env-file)
        if (($# < 2)); then
          err "--env-file needs a path"
          exit 2
        fi
        ENV_FILE="$2"
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
  readonly DRY_RUN ASSUME_YES ENV_FILE
}

# Collects the bindings of the deployed Workers.
load_bindings() {
  local w
  for w in "${WORKERS[@]}"; do
    BINDINGS+="$(cf GET "/workers/scripts/${PREFIX}-${w}/settings" \
      | jq -c '.result.bindings? // []')"
  done
}

# Succeeds (and warns) if a deployed Worker still references $1 or $2.
still_bound() {
  local needle
  for needle in "$@"; do
    [[ -n "${needle}" ]] || continue
    if grep -qF "\"${needle}\"" <<<"${BINDINGS}"; then
      note "${YELLOW}" "! kept ${1}: still bound by a deployed Worker (deploy V2.4 first)"
      return 0
    fi
  done
  return 1
}

cleanup_secrets() {
  local w existing name
  step "Delete V1.3 Worker secrets"
  for w in "${WORKERS[@]}"; do
    existing="$(cf GET "/workers/scripts/${PREFIX}-${w}/secrets" \
      | jq -r '.result[]?.name')"
    for name in "${LEGACY_SECRETS[@]}"; do
      grep -qxF "${name}" <<<"${existing}" || continue
      act "${PREFIX}-${w} secret ${name}" cf_ok DELETE \
        "/workers/scripts/${PREFIX}-${w}/secrets/${name}"
    done
  done
}

cleanup_d1() {
  local name="${PREFIX}-situation-awareness-db"
  local id
  step "Delete D1 ${name}"
  id="$(cf_list /d1/database '"\(.name) \(.uuid)"' | id_of "${name}")"
  [[ -n "${id}" ]] || return 0
  still_bound "${name}" "${id}" && return 0
  act "${name}" cf_ok DELETE "/d1/database/${id}"
}

cleanup_kv() {
  local existing name id
  step "Delete KV namespaces"
  existing="$(cf_list /storage/kv/namespaces '"\(.title) \(.id)"')"
  for name in "${PREFIX}-schema-cache" "${PREFIX}-gateway-config"; do
    id="$(id_of "${name}" <<<"${existing}")"
    [[ -n "${id}" ]] || continue
    still_bound "${name}" "${id}" && continue
    act "${name}" cf_ok DELETE "/storage/kv/namespaces/${id}"
  done
}

cleanup_queues() {
  local existing base name id
  step "Delete queues (consumers first)"
  existing="$(cf_list /queues '"\(.queue_name) \(.queue_id)"')"
  for base in "${LEGACY_QUEUES[@]}"; do
    for name in "${PREFIX}-${base}" "${PREFIX}-${base}-dlq"; do
      id="$(id_of "${name}" <<<"${existing}")"
      [[ -n "${id}" ]] || continue
      still_bound "${name}" && continue
      act "${name}" delete_queue "${id}"
    done
  done
}

cleanup_vectorize() {
  local name="${PREFIX}-decision-cases-bge-m3"
  step "Delete Vectorize index"
  cf_ok GET "/vectorize/v2/indexes/${name}" || return 0
  still_bound "${name}" && return 0
  act "${name}" cf_ok DELETE "/vectorize/v2/indexes/${name}"
}

cleanup_b2() {
  local bucket="${PREFIX}-raw"
  local key="${PREFIX}-data-integration"
  local id
  step "Delete B2 bucket ${bucket} and key ${key}"
  b2_authorize
  id="$(b2_bucket_id "${bucket}")"
  [[ -z "${id}" ]] || act "${bucket} (with all files)" b2_delete_bucket "${id}"
  while IFS= read -r id; do
    act "key ${key}" b2_delete_key "${id}"
  done < <(b2_keys | id_of "${key}")
}

cleanup_neo4j() {
  local name="${PREFIX}-graphdb"
  local id
  step "Delete Neo4j Aura instance ${name}"
  if [[ -z "${AURA_ID}" || -z "${AURA_SECRET}" ]]; then
    note "${DIM}" "– skipped (AURA_CLIENT_ID / AURA_CLIENT_SECRET unset)"
    return 0
  fi
  aura_authorize
  while IFS= read -r id; do
    act "${name} (${id})" aura_delete_instance "${id}"
  done < <(aura_instances | id_of "${name}")
}

main() {
  setup_colors
  parse_args "$@"
  load_config cf b2
  print_banner "OntoDecide V1.3 cleanup" "${PREFIX} (legacy resources)"
  confirm "${PREFIX}" "the V1.3 ${PREFIX} resources and their data"

  step "Read deployed Worker bindings"
  load_bindings
  note "${DIM}" "– ${#WORKERS[@]} Workers checked"
  cleanup_secrets
  cleanup_d1
  cleanup_kv
  cleanup_queues
  cleanup_vectorize
  cleanup_b2
  cleanup_neo4j

  print_summary "V1.3 leftovers are gone; drop the blocks in infra/legacy.tf."
}

main "$@"
