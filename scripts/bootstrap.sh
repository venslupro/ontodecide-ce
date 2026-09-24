#!/usr/bin/env bash
# One-time, idempotent setup for resources Terraform has no provider for.
#   ENV=prod|staging scripts/bootstrap.sh
# Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
#
# The Terraform state bucket (ontodecide-ce-tfstate, private, SSE-B2,
# versioned) must be created once by hand in the Backblaze console before
# the first `terraform init`, because the S3 backend cannot create it.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV="${ENV:-prod}"
SUFFIX=""
[[ "$ENV" == "prod" ]] || SUFFIX="-$ENV"
INDEX="decision-cases-bge-m3${SUFFIX}"

if npx wrangler vectorize get "$INDEX" >/dev/null 2>&1; then
  echo "vectorize index $INDEX exists"
else
  # bge-m3 produces 1024-dimensional embeddings.
  npx wrangler vectorize create "$INDEX" --dimensions=1024 --metric=cosine
  npx wrangler vectorize create-metadata-index "$INDEX" --property-name=tenantId --type=string
fi
