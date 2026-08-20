# ============================================================
# Input variables.
#
# All variables here are NON-SECRET configuration values.
#
# Secrets must NEVER be defined as Terraform input variables —
# Cloudflare's "Store credentials safely" best practice mandates
# passing them through the environment or a dedicated secret store:
#
#   Secret                        Source
#   ───────────────────────────── ──────────────────────────────────
#   Cloudflare API token          CLOUDFLARE_API_TOKEN    (env var)
#   JWT signing secret            TF_VAR_jwt_secret       (env var,
#                                               or GitHub Secret)
#   Neo4j password                TF_VAR_neo4j_password   (env var)
#   Workers.dev subdomain prefix  TF_VAR_cloudflare_account_id_or_workers_dev
#                                 (env var or GitHub Secret)
#   R2 backend access_key         Passed via `-backend-config`
#   R2 backend secret_key         Passed via `-backend-config`
#
# Note: TF_VAR_* environment variables are the OFFICIAL Terraform
# mechanism for providing input-variable values outside of tfvars.
# ============================================================

# ------------------------------------------------------------
# Cloudflare account + provider tuning
# ------------------------------------------------------------

variable "cloudflare_account_id" {
  description = <<-EOT
    Cloudflare account id. Leave blank to auto-discover via the
    API token (data.cloudflare_accounts.this). If the token lacks
    the Account List permission, set this explicitly or export
    CLOUDFLARE_ACCOUNT_ID in the shell.
  EOT
  type        = string
  default     = ""
}

# NOTE: There is intentionally NO `cloudflare_api_token` variable.
# The provider reads its token from the $CLOUDFLARE_API_TOKEN
# environment variable directly. See main.tf → provider block.

# ------------------------------------------------------------
# Project identity
# ------------------------------------------------------------

variable "project_name" {
  description = "Logical project name used as a prefix for all resources (lowercase, hyphen only)."
  type        = string
  default     = "ontodecide"
}

variable "environment" {
  description = <<-EOT
    Deployment environment tag (production, staging, ...).
    This is appended to every resource name so multiple
    environments can coexist.

    OFFICIAL Cloudflare best practice for multi-env isolation:
    > "To safely manage separate environments (staging, QA, UAT,
    > production), use separate Cloudflare accounts with separate
    > domains (such as example.com and example-staging.com)."
    >                              — Cloudflare Terraform Best Practices

    When following that recommendation, each Cloudflare account
    runs ONE environment with `environment = "production"`, and
    environment-level isolation comes from the separate account
    (and separate R2 state backend bucket), not this string.
  EOT
  type        = string
  default     = "production"
}

# ------------------------------------------------------------
# Shared secrets (passed via TF_VAR_* env, not written to file)
# ------------------------------------------------------------

variable "jwt_secret" {
  description = "Shared JWT signing secret (>= 32 random bytes). Pass via TF_VAR_jwt_secret env."
  type        = string
  sensitive   = true
}

variable "neo4j_password" {
  description = "Neo4j password. Pass via TF_VAR_neo4j_password env."
  type        = string
  sensitive   = true
}

# ------------------------------------------------------------
# Neo4j AuraDB connection
# ------------------------------------------------------------

variable "neo4j_url" {
  description = "Neo4j AuraDB base URL, e.g. https://neo4j+s://xxxxxxxx.databases.neo4j.io ."
  type        = string
}

variable "neo4j_user" {
  description = "Neo4j username."
  type        = string
  default     = "neo4j"
}

# ------------------------------------------------------------
# AI service defaults
# ------------------------------------------------------------

variable "default_provider" {
  description = "Default LLM provider id for the AI service (workers-ai|openai|anthropic|google|openrouter)."
  type        = string
  default     = "workers-ai"
}

variable "workers_ai_model" {
  description = "Workers AI model id used when default_provider == 'workers-ai'."
  type        = string
  default     = "@cf/meta/llama-3-8b-instruct"
}

# ------------------------------------------------------------
# Cross-worker service URL resolution
# ------------------------------------------------------------

variable "cloudflare_account_id_or_workers_dev" {
  description = <<-EOT
    Workers.dev subdomain of the Cloudflare account, used to build
    internal cross-worker service URLs.

    Example: if your worker is reachable at
    https://decision-user-service.myteam-a1b2.workers.dev, set this
    to "myteam-a1b2".

    Find it in the Cloudflare dashboard:
      Workers & Pages → Overview → right-hand column "Subdomain".
  EOT
  type        = string
  sensitive   = true
}
