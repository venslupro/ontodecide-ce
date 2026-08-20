#!/usr/bin/env bash
# Apply D1 migrations to the shared decision-db.
#
# Usage:
#   ./scripts/migrate.sh                  # apply locally
#   ./scripts/migrate.sh --remote         # apply to production
#   ./scripts/migrate.sh --remote --ai    # also apply AI migrations
set -euo pipefail

REMOTE_FLAG=""
APPLY_AI=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)  REMOTE_FLAG="--remote"; shift ;;
    --ai)      APPLY_AI=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--remote] [--ai]"
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

DB_NAME="decision-db"

echo "==> Applying User Service migrations..."
pnpm --filter=@ontodecide/user exec wrangler d1 migrations apply "${DB_NAME}" ${REMOTE_FLAG}

echo "==> Applying AI Service migrations..."
pnpm --filter=@ontodecide/ai exec wrangler d1 migrations apply "${DB_NAME}" ${REMOTE_FLAG}

if [[ ${APPLY_AI} -eq 1 ]]; then
  echo "==> AI migrations explicitly applied above."
fi

echo "==> Done. Remember to seed the bootstrap admin password:"
echo "    UPDATE users SET password_hash = '<pbkdf2 hash>' WHERE username = 'admin';"
