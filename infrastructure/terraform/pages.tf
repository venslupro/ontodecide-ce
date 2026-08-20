# ============================================================
# Cloudflare Pages: placeholder for the React dashboard.
#
# CLOUDFLARE RECOMMENDED DEPLOYMENT PATH (when a web frontend lands):
#
#   Use Cloudflare Pages Git-connected Builds (aka Pages Git
#   integration), NOT direct uploads / Terraform `source` blobs.
#
# Why?  Cloudflare recommends Git-connected Pages for every project
# that can connect a repo because it:
#   1. Runs builds on the same managed build image family as
#      Workers Builds, with pre-installed corepack / Node.js.
#   2. Provides preview deployments per PR.
#   3. Keeps content out of Terraform state (Pages static assets do
#      not belong in IaC state; Terraform owns project configuration
#      and bindings ONLY, not GBs of uploaded files).
#
# What Terraform keeps once the frontend is ready:
#   ✓ cloudflare_pages_project (this block, enabled below) with
#     build_config UNSET (let Pages Git Builds manage build/deploy
#     from the dashboard config) OR with build_config mirrored for
#     documentation.  Prefer the dashboard-config-only approach
#     because build commands drift otherwise.
#   ✓ cloudflare_pages_domain (custom domains attached to the
#     project).
#   ✓ cloudflare_pages_deployment_configurations / environment_vars
#     for non-secret runtime config.
#   × NEVER `pages assets` / direct file uploads via Terraform.
#
# The resource below is commented out on purpose: the web app is
# not part of the current project scope (see spec.md NG3 / NG5).
# When `apps/web` (or similar) exists, uncomment the block AND
# choose Cloudflare Pages Git Builds in the dashboard as the
# deploy mechanism — not direct upload.
# ============================================================

# resource "cloudflare_pages_project" "dashboard" {
#   account_id        = local.account_id
#   name              = "${var.project_name}-dashboard"
#   production_branch = "main"
#
#   # --------------------------------------------------------------
#   # Recommended: leave build_config empty here and manage it via
#   # Pages → Settings → Builds (Git-connected).  That mirrors the
#   # same Workers Builds "dashboard-first config, Terraform tracks
#   # bindings only" pattern we use for Workers.
#   #
#   # If you MUST also encode the build settings in Terraform for
#   # audit purposes, uncomment AND keep it byte-identical to the
#   # dashboard Build settings.  Typical values for a Vite/Next web
#   # app in a monorepo:
#   # --------------------------------------------------------------
#   # build_config {
#   #   build_command        = "corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --frozen-lockfile --prefer-offline && pnpm turbo run build --filter=@ontodecide/web"
#   #   destination_dir      = "apps/web/dist"
#   #   root_dir             = ""
#   # }
# }
