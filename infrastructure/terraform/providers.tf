# ============================================================================
# Cloudflare Provider 配置 (项目记忆硬约束对齐)
#   * 在 Cloudflare Provider v4 中，account_id / api_token 通过
#     环境变量 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN 注入，
#     而不是 provider 块内的字段。
# ============================================================================

provider "cloudflare" {
  # 鉴权走环境变量:
  #   CLOUDFLARE_API_TOKEN  — injected by GitHub Actions (secrets.CF_API_TOKEN)
  #   CLOUDFLARE_ACCOUNT_ID — injected via TF_VAR_account_id (secrets.CF_ACCOUNT_ID)
}
