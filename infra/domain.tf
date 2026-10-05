# Custom domain (修订说明书 4.1 / 4.4 / 4.5), only when var.domain is set.
# Terraform creates the Cloudflare zone (so its nameservers can be set at the
# registrar, e.g. NameSilo) and attaches the Pages custom domain
# ontodecide-ce.<domain> to the Pages project (DNS is created by Cloudflare
# automatically). The Workers Route ontodecide-ce.<domain>/api/* lives in
# apps/api-gateway/wrangler.jsonc.tpl.
#
#   ontodecide-ce.<domain>     Pages custom domain (CNAME → pages.dev, proxied)
#   <domain>                   301 → https://ontodecide-ce.<domain> (Redirect)
#   ontodecide-ce.pages.dev    301 → https://ontodecide-ce.<domain> (Bulk Redirect)
#   _dmarc.<domain>            TXT DMARC (var.dmarc_policy)
#   mail records               var.mail_dns_records (Resend / Brevo)
#   /api/*                     WAF rate limit: 30 requests / 10 s per IP
#   TLS                        Full (strict), TLS ≥ 1.2, Always Use HTTPS

locals {
  zone_count = var.domain == "" ? 0 : 1

  # Mail records keyed by a stable id; names normalized to FQDNs.
  mail_records = {
    for r in var.mail_dns_records :
    "${r.type}/${r.name}/${substr(sha1(r.content), 0, 8)}" => merge(r, {
      fqdn = (r.name == "@" ? var.domain :
      endswith(r.name, var.domain) ? r.name : "${r.name}.${var.domain}")
    })
  }

  # Bulk Redirect list names allow only [a-z0-9_] (exempt from the hyphen
  # naming rule, same segments).
  pages_redirect_list = "${replace(local.prefix, "-", "_")}_pages_redirect"
}

# Create the zone: assigning it in the account gives us the Cloudflare
# nameservers to delegate the registrar domain to. Free plan; status stays
# "pending" until the registrar NS change propagates.
resource "cloudflare_zone" "main" {
  count = local.zone_count
  account = {
    id = var.account_id
  }
  name   = var.domain
  type   = "full"
  paused = false
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

# Placeholder so apex requests reach the proxy and the redirect rule.
resource "cloudflare_dns_record" "apex" {
  count   = var.manage_apex_record ? local.zone_count : 0
  zone_id = cloudflare_zone.main[0].id
  name    = var.domain
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
  comment = "Redirected to ${local.app_origin}"
}

resource "cloudflare_dns_record" "dmarc" {
  count   = local.zone_count
  zone_id = cloudflare_zone.main[0].id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  content = "\"v=DMARC1; p=${var.dmarc_policy}; adkim=s; aspf=r\""
  ttl     = 3600
}

resource "cloudflare_dns_record" "mail" {
  for_each = var.domain == "" ? {} : local.mail_records
  zone_id  = cloudflare_zone.main[0].id
  name     = each.value.fqdn
  type     = each.value.type
  content  = each.value.type == "TXT" ? "\"${each.value.content}\"" : each.value.content
  priority = each.value.type == "MX" ? coalesce(each.value.priority, 10) : null
  proxied  = false
  ttl      = 3600
}

# Apex → app host (Single Redirect, http_request_dynamic_redirect phase).
resource "cloudflare_ruleset" "apex_redirect" {
  count       = local.zone_count
  zone_id     = cloudflare_zone.main[0].id
  name        = "${local.prefix}-apex-redirect"
  description = "Redirect the apex to the app host."
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"

  rules = [{
    ref         = "apex_to_app"
    description = "${var.domain} → ${local.app_origin}"
    expression  = "(http.host eq \"${var.domain}\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url = {
          expression = "concat(\"${local.app_origin}\", http.request.uri.path)"
        }
      }
    }
  }]
}

# The only rate-limit rule of the Free plan: every /api/* request, per IP
# (and colo, required on Free), 30 requests per 10 s, blocked for 10 s.
# Finer limits are the api-gateway Rate Limiting bindings.
resource "cloudflare_ruleset" "api_rate_limit" {
  count       = local.zone_count
  zone_id     = cloudflare_zone.main[0].id
  name        = "${local.prefix}-api-rate-limit"
  description = "Per-IP limit on the public API."
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = [{
    ref         = "api_per_ip"
    description = "/api/*: 30 requests / 10 s per IP"
    expression  = "(http.request.uri.path contains \"/api/\")"
    action      = "block"
    ratelimit = {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 10
      requests_per_period = 30
      mitigation_timeout  = 10
    }
  }]
}

# Zone TLS settings (Free plan). HSTS (setting security_header) is enabled
# in the dashboard: its v5 object value does not round-trip cleanly.
resource "cloudflare_zone_setting" "ssl" {
  count      = local.zone_count
  zone_id    = cloudflare_zone.main[0].id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  count      = local.zone_count
  zone_id    = cloudflare_zone.main[0].id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "always_use_https" {
  count      = local.zone_count
  zone_id    = cloudflare_zone.main[0].id
  setting_id = "always_use_https"
  value      = "on"
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
