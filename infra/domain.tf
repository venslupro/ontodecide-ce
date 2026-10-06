# Custom domain (修订说明书 4.1 / 4.4 / 4.5), only when var.domain is set.
# The Cloudflare zone is created if it does not exist; the CI workflow runs
# terraform import before apply so an existing zone is imported into state
# instead of being recreated. Terraform only manages the zone container
# itself — no zone-level DNS records, rulesets or TLS settings — and
# prevent_destroy blocks accidental terraform destroy.
#
#   ontodecide-ce.<domain>     Pages custom domain (CNAME → pages.dev, proxied)
#   ontodecide-ce.pages.dev    301 → https://ontodecide-ce.<domain> (Bulk Redirect)
#   /api/*                     Workers Route on ontodecide-ce.<domain>/api/*
#                              (apps/api-gateway/wrangler.jsonc.tpl)

locals {
  zone_count = var.domain == "" ? 0 : 1

  # Bulk Redirect list names allow only [a-z0-9_] (exempt from the hyphen
  # naming rule, same segments).
  pages_redirect_list = "${replace(local.prefix, "-", "_")}_pages_redirect"
}

resource "cloudflare_zone" "main" {
  count   = local.zone_count
  account = { id = var.account_id }
  name    = var.domain

  lifecycle {
    prevent_destroy = true
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
