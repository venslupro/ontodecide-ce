#!/usr/bin/env bash
# Two responsibilities:
#   1. BUILD one Worker in a way that is byte-for-byte equivalent to the
#      Build command pasted into Cloudflare Workers Builds → Dashboard →
#      Worker → Settings → Builds.
#   2. DEPLOY (--deploy-only) a Worker by running the EXACT same command
#      that Workers Builds runs for its Deploy step, i.e.
#          npx wrangler deploy --config apps/api/<name>/wrangler.toml
#
# The deploy path is callable via `pnpm run deploy --filter=@ontodecide/X`,
# which turbo remaps to `apps/api/X`'s deploy script; the turbo task graph
# for "deploy" falls through to this root script when an app's own
# package.json has no "deploy" script.  We therefore also accept the
# package name form "@ontodecide/X" here and silently resolve it to the
# matching apps/api/X/wrangler.toml path.
#
# Usage (BUILD mode, default):
#   ./scripts/build-worker.sh @ontodecide/gateway
#   ./scripts/build-worker.sh @ontodecide/gateway --dry-run
#
# Usage (DEPLOY mode, used by `pnpm run deploy --filter=...`):
#   ./scripts/build-worker.sh --deploy-only @ontodecide/gateway [--dry-run]
#   ./scripts/build-worker.sh --deploy-only apps/api/gateway
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  build-worker.sh <worker-package-name> [--dry-run]            BUILD mode
  build-worker.sh --deploy-only <worker-or-dir> [--dry-run]    DEPLOY mode

  worker-package-name    Workspace package name or directory.
                         One of:
                           @ontodecide/gateway   apps/api/gateway
                           @ontodecide/user      apps/api/user
                           @ontodecide/graph     apps/api/graph
                           @ontodecide/ingestion apps/api/ingestion
                           @ontodecide/ai        apps/api/ai
                           @ontodecide/cleanup   apps/api/cleanup

  --deploy-only          Run the Deploy command (wrangler deploy
                         --config) instead of the Build command.
                         Matches exactly what Workers Builds runs in
                         its Deploy step.

  --dry-run              Print the Build/Deploy command that would
                         execute without running it.

Build mode mirrors .cloudflare/workers-builds.yaml's Build command:
    corepack enable && corepack prepare pnpm@9.12.0 --activate \
      && pnpm install --frozen-lockfile --prefer-offline \
      && pnpm turbo run build --filter=<pkg>

Deploy mode mirrors .cloudflare/workers-builds.yaml's Deploy command:
    npx wrangler deploy --config apps/api/<name>/wrangler.toml
EOF
}

MODE="build"           # build | deploy
TARGET=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)   usage; exit 0 ;;
    --deploy-only) MODE="deploy"; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --)          shift; break ;;
    -*)          echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
    *)
      if [[ -z "${TARGET}" ]]; then
        TARGET="$1"; shift
      else
        echo "Unexpected positional arg: $1" >&2; usage >&2; exit 1
      fi ;;
  esac
done

# --- resolve <TARGET> → (package_name, wrangler_dir) --------------------
ALLOWED_PKGS=(
  '@ontodecide/gateway'   '@ontodecide/user'      '@ontodecide/graph'
  '@ontodecide/ingestion' '@ontodecide/ai'        '@ontodecide/cleanup'
)
ALLOWED_DIRS=(
  'apps/api/gateway'   'apps/api/user'      'apps/api/graph'
  'apps/api/ingestion' 'apps/api/ai'        'apps/api/cleanup'
)

pkg=""
dir=""
if [[ -z "${TARGET}" ]]; then
  echo "Missing required argument: <worker-package-name>" >&2
  usage >&2
  exit 1
fi
case "${TARGET}" in
  @ontodecide/*)
    pkg="${TARGET}"
    short="${pkg#@ontodecide/}"
    dir="apps/api/${short}"
    ;;
  apps/api/*)
    dir="${TARGET}"
    short="${dir#apps/api/}"
    pkg="@ontodecide/${short}"
    ;;
  *)
    echo "Invalid target: ${TARGET}" >&2
    echo "Expected @ontodecide/<name> or apps/api/<name>" >&2
    exit 1
    ;;
esac

# Validate against allowed lists so we error early on typos.
FOUND_PKG=0
for x in "${ALLOWED_PKGS[@]}"; do [[ "$x" == "${pkg}" ]] && FOUND_PKG=1; done
FOUND_DIR=0
for x in "${ALLOWED_DIRS[@]}"; do [[ "$x" == "${dir}" ]] && FOUND_DIR=1; done
if [[ "${FOUND_PKG}" -ne 1 || "${FOUND_DIR}" -ne 1 ]]; then
  echo "Invalid worker target: ${TARGET} → pkg=${pkg} dir=${dir}" >&2
  echo "Expected one of: ${ALLOWED_PKGS[*]}" >&2
  exit 1
fi

CONFIG_TOML="${dir}/wrangler.toml"
if [[ ! -f "${CONFIG_TOML}" ]]; then
  echo "Missing per-Worker wrangler.toml at ${CONFIG_TOML}" >&2
  exit 1
fi

# --- Deploy command (matches Workers Builds Deploy / Preview exactly) -
if [[ "${MODE}" == "deploy" ]]; then
  CMD="npx wrangler deploy --config ${CONFIG_TOML}"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "${CMD}"
    exit 0
  fi
  echo "==> Deploying Worker pkg=${pkg} via Workers Builds-equivalent Deploy command:"
  echo "    ${CMD}"
  echo "    (if this fails with ROOT_WRANGLER_SAFETY_TRIGGER_*, the root"
  echo "     wrangler.toml was reached — your --config path is wrong)"
  bash -c "${CMD}"
  echo "Deploy complete for ${pkg}."
  exit 0
fi

# --- THE FOLLOWING 4 LINES = Workers Builds Build command 1:1 ---------
CMD=$(cat <<EOF
corepack enable && \\
  corepack prepare pnpm@9.12.0 --activate && \\
  pnpm install --frozen-lockfile --prefer-offline && \\
  pnpm turbo run build --filter=${pkg}
EOF
)

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "${CMD}"
  exit 0
fi

echo "==> Building Worker ${pkg} with command equal to Workers Builds Build command:"
echo "    ${CMD}"
bash -c "${CMD}"
echo "Build complete for ${pkg}.  Artifacts live in the per-app dist/ directory."
