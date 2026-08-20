# ============================================================
# Cloudflare Pages: placeholder for the React dashboard.
#
# The frontend is not implemented yet (per project scope); this resource
# is documented so it can be enabled by switching the comment block
# below into a real resource when the web app lands.
# ============================================================

# resource "cloudflare_pages_project" "dashboard" {
#   account_id        = local.account_id
#   name              = "${var.project_name}-dashboard"
#   production_branch = "main"
#   build_config {
#     build_command        = "pnpm turbo run build --filter=@ontodecide/web"
#     destination_dir      = "apps/web/dist"
#     root_dir             = ""
#   }
# }
