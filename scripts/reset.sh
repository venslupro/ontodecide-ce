#!/usr/bin/env bash
# Deletes every deployed OntoDecide resource and service so the next
# Terraform → Deploy run starts from zero. Irreversible: back up or migrate
# data before running it. Never run by CI.
#
#   scripts/reset.sh [--dry-run] [--yes] [--legacy] [--env-file FILE]
#
#   --dry-run  Only list what would be deleted.
#   --yes      Skip the confirmation prompt.
#   --legacy   Also delete resources with pre-{project}-{env} names
#              (api-gateway, identity-access-db, ingest, ontodecide-ce-raw,
#              …). Exact names only; make sure nothing else in the account
#              uses them.
#   --env-file Local credentials file (default .env.local). It must be
#              gitignored; the script refuses a file tracked by git.
#
# Deleted, in dependency order: Pages project, 7 Workers, queues, D1, KV,
# Vectorize index, B2 raw bucket (emptied first) and its key, Neo4j Aura
# instance. Afterwards every resource is removed from the Terraform state.
# The state bucket ontodecide-ce-tfstate itself is never touched.
#
# Requires curl, jq, terraform and these variables, from the local
# credentials file (KEY=value lines, chmod 600) or the environment:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY      (B2 master key)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY       (state bucket key)
#   AURA_CLIENT_ID, AURA_CLIENT_SECRET
# The CI secret names (CF_API_TOKEN, B2_MASTER_KEY, …) are accepted too.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="ontodecide"
ENVIRONMENT="prd"
PREFIX="${PROJECT}-${ENVIRONMENT}"
PAGES_PROJECT="ontodecide-ce" # exempt from the naming rule (fixed URL)
STATE_BUCKET="ontodecide-ce-tfstate"

SERVICES="identity-access ontology-manager data-integration object-graph situation-awareness decision-engine"
# Root → leaf, so no Worker is deleted while another still binds to it.
WORKERS="api-gateway identity-access decision-engine situation-awareness object-graph data-integration ontology-manager"
QUEUES="ingest object-writes graph-sync situation-events decision-jobs"

DRY_RUN=false
ASSUME_YES=false
LEGACY=false
ENV_FILE=".env.local"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --yes) ASSUME_YES=true ;;
    --legacy) LEGACY=true ;;
    --env-file) ENV_FILE="${2:?--env-file needs a path}"; shift ;;
    -h | --help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# Credentials stay local: never read a file that is (or would be) committed.
if [[ -f "$ENV_FILE" ]]; then
  if git ls-files --error-unmatch "$ENV_FILE" >/dev/null 2>&1 ||
    ! git check-ignore -q "$ENV_FILE"; then
    echo "$ENV_FILE is not gitignored; refusing to read credentials from it" >&2
    exit 1
  fi
  if [[ -n "$(find "$ENV_FILE" -perm -004)" ]]; then
    echo "warning: $ENV_FILE is world-readable (chmod 600 $ENV_FILE)" >&2
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
elif [[ "$ENV_FILE" != ".env.local" ]]; then
  echo "$ENV_FILE not found" >&2
  exit 1
fi
CF_TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
B2_ID="${B2_APPLICATION_KEY_ID:-${B2_MASTER_KEY_ID:-}}"
B2_KEY="${B2_APPLICATION_KEY:-${B2_MASTER_KEY:-}}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${B2_STATE_KEY_ID:-$B2_ID}}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${B2_STATE_KEY:-$B2_KEY}}"
export TF_VAR_account_id="${TF_VAR_account_id:-$CF_ACCOUNT}"
AURA_ID="${AURA_CLIENT_ID:-${NEO4J_AURA_CLIENT_ID:-}}"
AURA_SECRET="${AURA_CLIENT_SECRET:-${NEO4J_AURA_CLIENT_SECRET:-}}"

missing=""
for v in CF_TOKEN CF_ACCOUNT B2_ID B2_KEY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AURA_ID AURA_SECRET; do
  [[ -n "${!v}" ]] || missing="$missing $v"
done
for bin in curl jq terraform; do
  command -v "$bin" >/dev/null || missing="$missing $bin"
done
if [[ -n "$missing" ]]; then
  echo "missing:$missing (set them in $ENV_FILE; see scripts/reset.sh --help)" >&2
  exit 1
fi

# ---- names ----------------------------------------------------------------

# Prints the names of one resource kind: current names, plus legacy ones
# with --legacy.
names() {
  local kind="$1" set pre s q
  for set in current legacy; do
    [[ "$set" == legacy && "$LEGACY" == false ]] && continue
    pre="${PREFIX}-"
    [[ "$set" == legacy ]] && pre=""
    case "$kind" in
      worker) for s in $WORKERS; do echo "${pre}${s}"; done ;;
      queue) for q in $QUEUES; do echo "${pre}${q}"; echo "${pre}${q}-dlq"; done ;;
      d1) for s in $SERVICES; do echo "${pre}${s}-db"; done ;;
      kv)
        if [[ "$set" == legacy ]]; then
          echo ontology-schema-cache; echo api-gateway-config
        else
          echo "${pre}schema-cache"; echo "${pre}gateway-config"
        fi
        ;;
      vectorize) echo "${pre}decision-cases-bge-m3" ;;
      b2-bucket) if [[ "$set" == legacy ]]; then echo ontodecide-ce-raw; else echo "${pre}raw"; fi ;;
      b2-key) echo "${pre}data-integration" ;;
      neo4j) if [[ "$set" == legacy ]]; then echo ontodecide-ce-graph; else echo "${pre}graphdb"; fi ;;
    esac
  done
}

# Prints the id of name $1 from "name id" lines on stdin.
id_of() { awk -v n="$1" '$1 == n {print $2}'; }

# ---- helpers --------------------------------------------------------------

FAILURES=0
log() { printf '%s\n' "$*"; }

# act DESCRIPTION CMD…: runs CMD unless --dry-run and records failures.
act() {
  local what="$1"; shift
  if [[ "$DRY_RUN" == true ]]; then
    log "  would delete $what"
  elif "$@"; then
    log "  deleted $what"
  else
    log "  FAILED  $what" >&2
    FAILURES=$((FAILURES + 1))
  fi
}

# Cloudflare API: cf METHOD PATH; prints the JSON body.
cf() {
  curl -sS -X "$1" -H "Authorization: Bearer ${CF_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}$2"
}
cf_ok() { cf "$@" | jq -e '.success == true' >/dev/null; }

# Prints jq filter $2 over every page of Cloudflare collection $1.
cf_list() {
  local path="$1" filter="$2" page=1 sep='?' body
  [[ "$path" == *\?* ]] && sep='&'
  while :; do
    body="$(cf GET "${path}${sep}page=${page}&per_page=100")"
    jq -r ".result[]? | ${filter}" <<<"$body"
    [[ "$(jq '.result | length' <<<"$body")" -lt 100 ]] && break
    page=$((page + 1))
  done
}

# Backblaze B2 native API: b2 CALL JSON.
b2() { curl -sS -H "Authorization: ${B2_TOKEN}" -d "$2" "${B2_API}/b2api/v3/$1"; }

# ---- confirmation ---------------------------------------------------------

log "Reset ${PREFIX}$([[ "$LEGACY" == true ]] && echo ' (including legacy names)')$([[ "$DRY_RUN" == true ]] && echo ' — dry run')"
if [[ "$DRY_RUN" == false && "$ASSUME_YES" == false ]]; then
  log "This permanently deletes all ${PREFIX} resources, services and data."
  read -r -p "Type ${PREFIX} to continue: " answer
  [[ "$answer" == "$PREFIX" ]] || { log "aborted"; exit 1; }
fi

# ---- Cloudflare -----------------------------------------------------------

log "Pages"
delete_pages() {
  cf_ok DELETE "/pages/projects/${PAGES_PROJECT}" && return 0
  # Projects with many deployments must be emptied first.
  local id
  for id in $(cf_list "/pages/projects/${PAGES_PROJECT}/deployments" '.id'); do
    cf DELETE "/pages/projects/${PAGES_PROJECT}/deployments/${id}?force=true" >/dev/null
  done
  cf_ok DELETE "/pages/projects/${PAGES_PROJECT}"
}
if cf_ok GET "/pages/projects/${PAGES_PROJECT}"; then
  act "pages project ${PAGES_PROJECT}" delete_pages
fi

log "Workers"
existing="$(cf GET /workers/scripts | jq -r '.result[]?.id')"
for w in $(names worker); do
  grep -qxF "$w" <<<"$existing" || continue
  act "worker $w" cf_ok DELETE "/workers/scripts/${w}?force=true"
done

log "Queues"
existing="$(cf_list /queues '"\(.queue_name) \(.queue_id)"')"
for q in $(names queue); do
  id="$(id_of "$q" <<<"$existing")"
  [[ -n "$id" ]] && act "queue $q" cf_ok DELETE "/queues/${id}"
done

log "D1"
existing="$(cf_list /d1/database '"\(.name) \(.uuid)"')"
for d in $(names d1); do
  id="$(id_of "$d" <<<"$existing")"
  [[ -n "$id" ]] && act "d1 $d" cf_ok DELETE "/d1/database/${id}"
done

log "KV"
existing="$(cf_list /storage/kv/namespaces '"\(.title) \(.id)"')"
for k in $(names kv); do
  id="$(id_of "$k" <<<"$existing")"
  [[ -n "$id" ]] && act "kv $k" cf_ok DELETE "/storage/kv/namespaces/${id}"
done

log "Vectorize"
for v in $(names vectorize); do
  cf_ok GET "/vectorize/v2/indexes/${v}" || continue
  act "vectorize $v" cf_ok DELETE "/vectorize/v2/indexes/${v}"
done

# ---- Backblaze B2 ---------------------------------------------------------

log "B2"
auth="$(curl -sS -u "${B2_ID}:${B2_KEY}" https://api.backblazeb2.com/b2api/v3/b2_authorize_account)"
B2_TOKEN="$(jq -r '.authorizationToken // empty' <<<"$auth")"
B2_API="$(jq -r '.apiInfo.storageApi.apiUrl // empty' <<<"$auth")"
B2_ACCOUNT="$(jq -r '.accountId // empty' <<<"$auth")"
[[ -n "$B2_TOKEN" ]] || { echo "B2 authorization failed" >&2; exit 1; }

# Deletes every file version and unfinished upload of bucket $1, then the
# bucket.
delete_bucket() {
  local bucket="$1" body next_name="" next_id="" f id
  while :; do
    body="$(b2 b2_list_file_versions "$(jq -nc --arg b "$bucket" --arg n "$next_name" --arg i "$next_id" \
      '{bucketId: $b, maxFileCount: 1000} + (if $n != "" then {startFileName: $n, startFileId: $i} else {} end)')")"
    while read -r f; do
      [[ -n "$f" ]] && b2 b2_delete_file_version "$(jq -c '. + {bypassGovernance: true}' <<<"$f")" >/dev/null
    done < <(jq -c '.files[]? | {fileName, fileId}' <<<"$body")
    next_name="$(jq -r '.nextFileName // empty' <<<"$body")"
    next_id="$(jq -r '.nextFileId // empty' <<<"$body")"
    [[ -z "$next_name" ]] && break
  done
  for id in $(b2 b2_list_unfinished_large_files "$(jq -nc --arg b "$bucket" '{bucketId: $b}')" | jq -r '.files[]?.fileId'); do
    b2 b2_cancel_large_file "$(jq -nc --arg i "$id" '{fileId: $i}')" >/dev/null
  done
  b2 b2_delete_bucket "$(jq -nc --arg a "$B2_ACCOUNT" --arg b "$bucket" '{accountId: $a, bucketId: $b}')" |
    jq -e '.bucketId' >/dev/null
}

delete_b2_key() {
  b2 b2_delete_key "$(jq -nc --arg i "$1" '{applicationKeyId: $i}')" | jq -e '.applicationKeyId' >/dev/null
}

for name in $(names b2-bucket); do
  [[ "$name" == "$STATE_BUCKET" ]] && continue
  id="$(b2 b2_list_buckets "$(jq -nc --arg a "$B2_ACCOUNT" --arg n "$name" '{accountId: $a, bucketName: $n}')" |
    jq -r '.buckets[0]?.bucketId // empty')"
  [[ -n "$id" ]] && act "b2 bucket $name (with all files)" delete_bucket "$id"
done

existing="$(b2 b2_list_keys "$(jq -nc --arg a "$B2_ACCOUNT" '{accountId: $a, maxKeyCount: 1000}')" |
  jq -r '.keys[]? | "\(.keyName) \(.applicationKeyId)"')"
for k in $(names b2-key); do
  for id in $(id_of "$k" <<<"$existing"); do
    act "b2 key $k" delete_b2_key "$id"
  done
done

# ---- Neo4j Aura -----------------------------------------------------------

log "Neo4j Aura"
AURA_TOKEN="$(curl -sS -u "${AURA_ID}:${AURA_SECRET}" -d grant_type=client_credentials \
  https://api.neo4j.io/oauth/token | jq -r '.access_token // empty')"
[[ -n "$AURA_TOKEN" ]] || { echo "Aura authorization failed" >&2; exit 1; }

delete_aura() {
  curl -sS -f -o /dev/null -X DELETE -H "Authorization: Bearer ${AURA_TOKEN}" \
    "https://api.neo4j.io/v1/instances/$1"
}

existing="$(curl -sS -H "Authorization: Bearer ${AURA_TOKEN}" https://api.neo4j.io/v1/instances |
  jq -r '.data[]? | "\(.name) \(.id)"')"
for n in $(names neo4j); do
  for id in $(id_of "$n" <<<"$existing"); do
    act "neo4j instance $n ($id)" delete_aura "$id"
  done
done

# ---- Terraform state ------------------------------------------------------

log "Terraform state (${STATE_BUCKET})"
terraform -chdir=infra init -input=false -reconfigure >/dev/null
addresses="$(terraform -chdir=infra state list | grep -v '^data\.' || true)"
if [[ -z "$addresses" ]]; then
  log "  already empty"
elif [[ "$DRY_RUN" == true ]]; then
  while read -r a; do log "  would remove $a"; done <<<"$addresses"
elif [[ "$FAILURES" -gt 0 ]]; then
  log "  kept: some deletions failed; rerun after fixing them"
else
  # shellcheck disable=SC2086  # addresses is a whitespace-separated list.
  terraform -chdir=infra state rm $addresses >/dev/null
  log "  removed $(wc -l <<<"$addresses" | tr -d ' ') resources"
fi

if [[ "$FAILURES" -gt 0 ]]; then
  log "Done with ${FAILURES} failure(s); rerun to retry (the script is idempotent)."
  exit 1
fi
log "Done. The next Terraform → Deploy run recreates everything."
