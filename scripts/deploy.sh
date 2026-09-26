#!/usr/bin/env bash
# Deploys all Workers (leaf → root), applies D1 migrations and uploads
# secrets, then publishes the Pages project. Used by .github/workflows/deploy.yml
# (production only, from main).
#
#   scripts/deploy.sh
#
# Expects: rendered apps/*/wrangler.jsonc (scripts/gen_wrangler.mjs), a built
# apps/web/dist, CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID, and secret
# values in the environment (JWT_SECRET, APPROVAL_SECRET, WRITEBACK_SECRET,
# CONNECTOR_ENC_KEY, BOOTSTRAP_ADMIN_PASSWORD, GEMINI_API_KEY, GROQ_API_KEY,
# B2_KEY_ID, B2_APP_KEY, NEO4J_URL, NEO4J_USER, NEO4J_PASSWORD).
set -euo pipefail
cd "$(dirname "$0")/.."

ORDER=(ontology-manager data-integration object-graph situation-awareness decision-engine identity-access api-gateway)

# Writes the JSON object of the named secrets that are set to stdout.
secrets_json() {
  node -e '
    const out = {};
    for (const k of process.argv.slice(1)) if (process.env[k]) out[k] = process.env[k];
    process.stdout.write(JSON.stringify(out));
  ' "$@"
}

worker_secrets() {
  case "$1" in
    api-gateway) secrets_json JWT_SECRET ;;
    identity-access) secrets_json JWT_SECRET BOOTSTRAP_ADMIN_PASSWORD ;;
    data-integration) secrets_json B2_KEY_ID B2_APP_KEY CONNECTOR_ENC_KEY ;;
    object-graph) secrets_json APPROVAL_SECRET WRITEBACK_SECRET NEO4J_URL NEO4J_USER NEO4J_PASSWORD ;;
    decision-engine) secrets_json APPROVAL_SECRET GEMINI_API_KEY GROQ_API_KEY ;;
    *) echo '{}' ;;
  esac
}

for w in "${ORDER[@]}"; do
  cfg="apps/${w}/wrangler.jsonc"
  db=$(node -e 'const c=require("fs").readFileSync(process.argv[1],"utf8").replace(/^\/\/.*$/m,"");const j=JSON.parse(c);console.log(j.d1_databases?.[0]?.database_name??"")' "$cfg")
  if [[ -n "$db" ]]; then
    echo "::group::migrate ${db} (${w})"
    CI=true npx wrangler d1 migrations apply "$db" --remote -c "$cfg"
    echo "::endgroup::"
  fi
  echo "::group::deploy ${w}"
  npx wrangler deploy -c "$cfg"
  secrets=$(worker_secrets "$w")
  if [[ "$secrets" != "{}" ]]; then
    printf '%s' "$secrets" | npx wrangler secret bulk -c "$cfg"
  fi
  echo "::endgroup::"
done

echo "::group::deploy pages"
(cd apps/web && npx wrangler pages deploy dist --project-name ontodecide-ce --branch main)
echo "::endgroup::"
