# ============================================================================
# Cloudflare Provider configuration (aligned with project memory hard constraints)
#   * account_id / api_token are injected via environment variables
#     CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN.
# ============================================================================

provider "cloudflare" {
  # Authentication via environment variables:
  #   CLOUDFLARE_API_TOKEN  — injected by GitHub Actions (secrets.CF_API_TOKEN)
  #   CLOUDFLARE_ACCOUNT_ID — injected via TF_VAR_account_id (secrets.CF_ACCOUNT_ID)
}
