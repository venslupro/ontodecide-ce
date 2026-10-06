#!/usr/bin/env bash
# Local full stack: 7 Workers in one `wrangler dev` session (local D1,
# Durable Objects and Queues — no Cloudflare quota used) plus the Vite dev
# server on http://localhost:5173, which proxies /api (and the WebSocket)
# to the gateway like the Pages Functions proxy does in production.
#
#   pnpm dev            # gateway on :8787, web on http://localhost:5173
#   pnpm dev --api-only # workers only
#
# Open the app at http://localhost:5173 (not 127.0.0.1): APP_ORIGIN and the
# WebAuthn RP id are `localhost`. E-mails are not sent (EMAIL_MODE=log): the
# identity-access log shows each code. Dev secrets (incl. the admin setup
# code) are in .wrangler/dev-secrets.json; Turnstile uses the always-pass
# test keys. Crons run via http://127.0.0.1:8787/__scheduled?cron=...
set -euo pipefail
cd "$(dirname "$0")/.."

readonly STATE=".wrangler/state"
readonly PREFIX="ontodecide-local"
# Workers with a D1 database (situation-awareness uses its Durable Object).
readonly -a D1_WORKERS=(
  identity-access ontology-manager data-integration object-graph
  decision-engine
)
# Every Worker except the gateway, which is the primary (first) config.
readonly -a SERVICES=(
  identity-access ontology-manager data-integration object-graph
  situation-awareness decision-engine
)

node scripts/gen_wrangler.mjs --env local

for w in "${D1_WORKERS[@]}"; do
  # D1 names follow {project}-{env}-{service}-db (scripts/gen_wrangler.mjs);
  # migrations come from migrations/<service>/. Local state left over from
  # V1.3 is dropped (--reset-legacy).
  node scripts/d1_migrate.mjs -c "apps/${w}/wrangler.jsonc" --local \
    --persist-to "${STATE}" --reset-legacy >/dev/null
  echo "migrated ${PREFIX}-${w}-db"
done

configs=(-c apps/api-gateway/wrangler.jsonc)
for w in "${SERVICES[@]}"; do configs+=(-c "apps/${w}/wrangler.jsonc"); done

trap 'kill 0' EXIT
npx wrangler dev "${configs[@]}" --persist-to "${STATE}" --port 8787 \
  --ip 127.0.0.1 --test-scheduled &
if [[ "${1:-}" != "--api-only" ]]; then
  VITE_TURNSTILE_SITE_KEY="${VITE_TURNSTILE_SITE_KEY:-1x00000000000000000000AA}" \
    pnpm --filter @ontodecide/web dev --host localhost &
fi
wait
