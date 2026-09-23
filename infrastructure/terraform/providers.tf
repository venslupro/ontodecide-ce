# ============================================================================
# Provider configuration (aligned with project memory hard constraints)
#   * Cloudflare: account_id / api_token via env vars
#   * Backblaze B2: application_key_id / application_key via env vars
#   * Neo4j Aura: client_id / client_secret via env vars
# ============================================================================

provider "cloudflare" {
  # Authentication via environment variables:
  #   CLOUDFLARE_API_TOKEN  — injected by GitHub Actions (secrets.CF_API_TOKEN)
  #   CLOUDFLARE_ACCOUNT_ID — injected via TF_VAR_account_id (secrets.CF_ACCOUNT_ID)
}

provider "b2" {
  # Authentication via environment variables:
  #   B2_APPLICATION_KEY_ID  — injected by GitHub Actions (secrets.B2_MASTER_KEY_ID)
  #   B2_APPLICATION_KEY     — injected by GitHub Actions (secrets.B2_MASTER_KEY)
  # Same B2 master key used for the S3 backend in versions.tf.
}

provider "neo4jaura" {
  # Authentication via environment variables:
  #   AURA_CLIENT_ID     — injected by GitHub Actions (secrets.NEO4J_AURA_CLIENT_ID)
  #   AURA_CLIENT_SECRET — injected by GitHub Actions (secrets.NEO4J_AURA_CLIENT_SECRET)
}
