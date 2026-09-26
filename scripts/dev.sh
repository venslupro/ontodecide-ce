#!/usr/bin/env bash
# Local full stack: 7 Workers in one `wrangler dev` session (local D1, KV,
# Durable Objects and Queues — no Cloudflare quota used) plus the Vite dev
# server, which proxies /api to the gateway like the Pages Function does.
#
#   pnpm dev            # gateway on :8787, web on :5173
#   pnpm dev --api-only # workers only
set -euo pipefail
cd "$(dirname "$0")/.."

STATE=".wrangler/state"
WORKERS=(identity-access ontology-manager data-integration object-graph situation-awareness decision-engine)

node scripts/gen_wrangler.mjs --env local

for w in "${WORKERS[@]}"; do
  # D1 names follow {project}-{env}-{service}-db (scripts/gen_wrangler.mjs).
  CI=true npx wrangler d1 migrations apply "ontodecide-local-${w}-db" --local \
    --persist-to "$STATE" -c "apps/${w}/wrangler.jsonc" >/dev/null
  echo "migrated ontodecide-local-${w}-db"
done

configs=(-c apps/api-gateway/wrangler.jsonc)
for w in "${WORKERS[@]}"; do configs+=(-c "apps/${w}/wrangler.jsonc"); done

trap 'kill 0' EXIT
npx wrangler dev "${configs[@]}" --persist-to "$STATE" --port 8787 --ip 127.0.0.1 --test-scheduled &
if [[ "${1:-}" != "--api-only" ]]; then
  pnpm --filter @ontodecide/web dev --host 127.0.0.1 &
fi
wait
