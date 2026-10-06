# Custom domain (修订说明书 4.1 / 4.4 / 4.5), only when var.domain is set.
# The apex domain's DNS stays with its registrar (NameSilo); no Cloudflare
# zone is created here, so other projects on the same apex domain (e.g.
# ontodecide.<domain>) are untouched. The operator creates a CNAME at the
# DNS provider: ontodecide-ce.<domain> → ontodecide-ce.pages.dev.
#
#   ontodecide-ce.<domain>     Pages custom domain, attached by Wrangler in
#                              the CD pipeline (not Terraform)
#   ontodecide-ce.pages.dev    301 → https://ontodecide-ce.<domain> (account-
#                              level Bulk Redirect, Terraform-managed below)
#   /api/*                     Pages Functions proxy (GATEWAY service
#                              binding); no Cloudflare zone → no Workers Route

locals {
  domain_count = var.domain == "" ? 0 : 1

  # Bulk Redirect list names allow only [a-z0-9_] (exempt from the hyphen
  # naming rule, same segments).
  pages_redirect_list = "${replace(local.prefix, "-", "_")}_pages_redirect"
}

# ontodecide-ce.pages.dev (and its preview subdomains) → app host, so the
# app is only used from the custom domain (account-level Bulk Redirect).
resource "cloudflare_list" "pages_redirect" {
  count       = local.domain_count
  account_id  = var.account_id
  name        = local.pages_redirect_list
  description = "${local.pages_host} → ${local.app_origin}"
  kind        = "redirect"

  items = [{
    redirect = {
      source_url            = "${local.pages_host}/"
      target_url            = "${local.app_origin}/"
      status_code           = 301
      include_subdomains    = true
      subpath_matching      = true
      preserve_path_suffix  = true
      preserve_query_string = true
    }
  }]
}

resource "cloudflare_ruleset" "pages_redirect" {
  count       = local.domain_count
  account_id  = var.account_id
  name        = "${local.prefix}-pages-redirect"
  description = "Bulk redirect of the pages.dev host."
  kind        = "root"
  phase       = "http_request_redirect"

  rules = [{
    ref         = "pages_dev_to_app"
    description = "${local.pages_host} → ${local.app_origin}"
    expression  = format("http.request.full_uri in $%s", cloudflare_list.pages_redirect[0].name)
    action      = "redirect"
    action_parameters = {
      from_list = {
        name = cloudflare_list.pages_redirect[0].name
        key  = "http.request.full_uri"
      }
    }
  }]
}
