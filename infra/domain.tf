# Custom domain (修订说明书 4.1 / 4.4 / 4.5), only when var.domain is set.
# The Cloudflare zone already exists in the account (owned by the project
# that uses the apex domain). Terraform only looks it up here, then attaches
# the Pages custom domain ontodecide-ce.<domain> to the Pages project (DNS
# is created by Cloudflare automatically) and bulk-redirects the pages.dev
# host to it.
#
#   ontodecide-ce.<domain>     Pages custom domain (CNAME → pages.dev, proxied)
#   ontodecide-ce.pages.dev    301 → https://ontodecide-ce.<domain> (Bulk Redirect)
#   /api/*                     Workers Route on ontodecide-ce.<domain>/api/*
#                              (apps/api-gateway/wrangler.jsonc.tpl)
#
# Zone-level resources (apex DNS records, _dmarc, mail records, apex redirect,
# TLS settings, WAF rate limit) belong to the project that owns the apex zone
# and are not managed here. Run scripts/reset.sh before each apply to start
# from zero; it never deletes the zone itself.

locals {
  zone_count = var.domain == "" ? 0 : 1

  # Bulk Redirect list names allow only [a-z0-9_] (exempt from the hyphen
  # naming rule, same segments).
  pages_redirect_list = "${replace(local.prefix, "-", "_")}_pages_redirect"
}

# Look up the existing Cloudflare zone owned by another project; only reads
# its id and metadata. Terraform never creates, modifies or deletes the zone.
data "cloudflare_zone" "main" {
  count = local.zone_count
  filter = {
    name = var.domain
  }
}

# Pages custom domain: Cloudflare creates the proxied CNAME
# ontodecide-ce.<domain> → ontodecide-ce.pages.dev automatically, so no
# separate cloudflare_dns_record is needed here.
resource "cloudflare_pages_domain" "app" {
  count        = local.zone_count
  account_id   = var.account_id
  project_name = cloudflare_pages_project.web.name
  name         = local.app_host
}

# ontodecide-ce.pages.dev (and its preview subdomains) → app host, so the
# app is only used from the custom domain (account-level Bulk Redirect).
resource "cloudflare_list" "pages_redirect" {
  count       = local.zone_count
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
  count       = local.zone_count
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
