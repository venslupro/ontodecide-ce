#!/usr/bin/env bash
# Bootstrap a fresh clone for Cloudflare Workers Builds.
#
# Cloudflare Workers Builds runs in a build environment that has Node.js
# preinstalled; this script installs pnpm via corepack and runs the build
# for a single worker. It is intended to be invoked from the worker's
# wrangler.toml `[build].command` field:
#
#   command = "./scripts/build-worker.sh @ontodecide/gateway"
set -euo pipefail

worker="${1:-}"

if [[ -z "${worker}" ]]; then
  echo "Usage: $0 <worker-package-name>" >&2
  echo "  e.g. $0 @ontodecide/gateway" >&2
  exit 1
fi

# Install pnpm via corepack (the build image ships corepack).
corepack enable
corepack prepare pnpm@9.12.0 --activate

# Install all workspace dependencies so the shared package builds first.
pnpm install --frozen-lockfile --prefer-offline

# Build the requested worker (turbo will build the shared dependency too).
pnpm turbo run build --filter="${worker}"

echo "Build complete for ${worker}."
