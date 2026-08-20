# ============================================================
# Input variables.
#
# STANDARD: Google Cloud Terraform Style Guide
#   https://cloud.google.com/docs/terraform/best-practices
#
# Key rules enforced in this file:
#   1. Every variable has a validation block with a readable,
#      actionable error message (never leave validation failures
#      cryptic).
#   2. Description strings follow the form
#      "<TYPE: ...> <PURPOSE sentence.> [Default: ...]."
#      and always end with a period.
#   3. Secret strings carry `sensitive = true` and are NEVER
#      defaulted to a placeholder.
#   4. Enumeration-style values are validated against an
#      explicit list (no ad-hoc "contains" checks).
#   5. Length / format validations use the shortest regex that
#      correctly expresses the contract.
#
# Secret delivery mechanism (consistent with Cloudflare + B2
# official best practices):
#
#   Secret / credential             Delivery mechanism
#   ─────────────────────────────── ──────────────────────────────
#   Cloudflare API token            CLOUDFLARE_API_TOKEN env var
#                                   (NOT a Terraform variable —
#                                    read directly by the provider)
#   JWT signing secret              TF_VAR_jwt_secret env var
#                                   (GitHub Secret in CI)
#   Neo4j AuraDB password           TF_VAR_neo4j_password env var
#                                   (GitHub Secret in CI)
#   Workers.dev subdomain prefix    TF_VAR_cloudflare_account_id_or_workers_dev
#                                   env var (GitHub Secret in CI)
#   B2 state-backend keyID          AWS_ACCESS_KEY_ID env var
#     (= TF_B2_STATE_KEY_ID)       (mapped by CI to the bundled
#                                   AWS SDK inside backend "s3")
#   B2 state-backend secret         AWS_SECRET_ACCESS_KEY env var
#     (= TF_B2_STATE_APPLICATION_KEY)
#   B2 business-buckets keyID       TF_VAR_b2_application_key_id
#   B2 business-buckets secret      TF_VAR_b2_application_key
#
#   NOTE: TF_VAR_* environment variables are the STANDARD
#   Terraform mechanism for passing input-variable values
#   outside of tfvars files. This file intentionally contains
#   no *.auto.tfvars entries.
# ============================================================

# ------------------------------------------------------------
# Cloudflare account + provider tuning
# ------------------------------------------------------------

variable "cloudflare_account_id" {
  description = <<-EOT
    TYPE: Optional string.
    PURPOSE: Cloudflare numeric account identifier.

    When empty (the default), the account id is auto-discovered
    via the data.cloudflare_accounts.this data source using
    the CLOUDFLARE_API_TOKEN credential. Set this explicitly
    only when the token does not grant the "Account List"
    permission, or when the same token is valid across more
    than one account.

    Default: "" (auto-discover).
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.cloudflare_account_id == "" || length(var.cloudflare_account_id) >= 16
    error_message = "var.cloudflare_account_id must be empty (auto-discover) or a 32-hex-char Cloudflare account id. Got empty-vs-too-short string."
  }
}

# NOTE: There is intentionally NO `cloudflare_api_token` variable.
# The cloudflare provider reads its token from the
# $CLOUDFLARE_API_TOKEN environment variable directly. See
# main.tf → provider "cloudflare" block.

# ------------------------------------------------------------
# Project identity
# ------------------------------------------------------------

variable "project_name" {
  description = <<-EOT
    TYPE: Required string (has default).
    PURPOSE: Logical project name used as a prefix for every
    globally-named resource (B2 buckets, KV namespaces, script
    names, etc.). Must match ^[a-z0-9-]{3,30}$.

    Default: "ontodecide".
  EOT
  type        = string
  default     = "ontodecide"

  validation {
    condition     = can(regex("^[a-z0-9-]{3,30}$", var.project_name))
    error_message = "var.project_name must be 3-30 chars: lowercase letters, digits, hyphen only."
  }
}

variable "environment" {
  description = <<-EOT
    TYPE: Required string (has default). Allowed values:
    "production" | "staging".
    PURPOSE: Deployment environment tag appended as a suffix
    to resource names so multiple environments can coexist on
    a single account. IMPORTANT: Cloudflare's official
    multi-env best practice recommends SEPARATE Cloudflare
    accounts per environment (and separate domains), not a
    shared account differentiated only by this tag. The tag
    exists for resource-name disambiguation when that
    recommendation has not yet been adopted.

    Default: "production".
  EOT
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "var.environment must be exactly \"production\" or \"staging\"."
  }
}

# ------------------------------------------------------------
# Shared secrets (delivered via TF_VAR_* env vars)
# ------------------------------------------------------------

variable "jwt_secret" {
  description = <<-EOT
    TYPE: Required secret string. Sensitive: true.
    PURPOSE: HMAC signing secret for JWT access tokens issued
    by the gateway / user services. Must be >= 32 raw bytes of
    high-entropy random data. Recommendation: generate with
    `openssl rand -base64 48` and use the raw output.

    Rotation: supported without user-visible downtime by
    replacing the value; existing tokens issued under the old
    key will become invalid on the next verification pass and
    users will be asked to re-authenticate.

    Delivery: TF_VAR_jwt_secret environment variable (GitHub
    Actions Secret: TF_VAR_jwt_secret).
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.jwt_secret) >= 32
    error_message = "var.jwt_secret must be at least 32 bytes (high-entropy random). Generate with `openssl rand -base64 48`."
  }
}

variable "neo4j_password" {
  description = <<-EOT
    TYPE: Required secret string. Sensitive: true.
    PURPOSE: Password for the Neo4j AuraDB user specified in
    var.neo4j_user. This value is injected into the User &
    Cleanup Workers as a Worker-level secret binding so it
    never appears in plain source.

    Rotation: change the value in the Neo4j Aura dashboard
    first, then update the GitHub Secret; Workers will pick
    up the new value on their next deploy.

    Delivery: TF_VAR_neo4j_password environment variable
    (GitHub Actions Secret: TF_VAR_neo4j_password).
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = var.neo4j_password != ""
    error_message = "var.neo4j_password must be a non-empty secret string. Copy the password from your Neo4j AuraDB dashboard."
  }
}

# ------------------------------------------------------------
# Neo4j AuraDB connection
# ------------------------------------------------------------

variable "neo4j_url" {
  description = <<-EOT
    TYPE: Required string.
    PURPOSE: Base URL for the Neo4j AuraDB cluster. Must match
    one of the two official AuraDB scheme forms:
      https://<dbid>.databases.neo4j.io        (HTTPS API)
      neo4j+s://<dbid>.databases.neo4j.io      (bolt + TLS)
    The Workers integration uses the HTTPS form; the "bolt"
    form is simultaneously accepted to support local tooling.

    Example: "https://neo4j+s://a1b2c3d4.databases.neo4j.io".

    Delivery: TF_VAR_neo4j_url environment variable (GitHub
    Actions Variable: TF_VAR_neo4j_url).
  EOT
  type        = string

  validation {
    condition = (
      can(regex("^https://[a-z0-9-]+\\.databases\\.neo4j\\.io$", var.neo4j_url)) ||
      can(regex("^neo4j\\+s://[a-z0-9-]+\\.databases\\.neo4j\\.io$", var.neo4j_url))
    )
    error_message = "var.neo4j_url must match ^https://<id>.databases.neo4j.io or ^neo4j+s://<id>.databases.neo4j.io (no trailing slash)."
  }
}

variable "neo4j_user" {
  description = <<-EOT
    TYPE: Required string (has default).
    PURPOSE: Username used when authenticating to the Neo4j
    AuraDB cluster referenced by var.neo4j_url. For AuraDB the
    canonical username is the literal string "neo4j".

    Default: "neo4j".
  EOT
  type        = string
  default     = "neo4j"

  validation {
    condition     = var.neo4j_user != ""
    error_message = "var.neo4j_user must be non-empty. For AuraDB this is almost always \"neo4j\"."
  }
}

# ------------------------------------------------------------
# AI service defaults
# ------------------------------------------------------------

variable "default_provider" {
  description = <<-EOT
    TYPE: Required string (has default). Allowed values:
    "workers-ai" | "openai" | "anthropic" | "google" | "openrouter".
    PURPOSE: Default LLM provider used by the AI Worker when a
    request does not specify a provider override.

    Default: "workers-ai".
  EOT
  type        = string
  default     = "workers-ai"

  validation {
    condition = contains(
      ["workers-ai", "openai", "anthropic", "google", "openrouter"],
      var.default_provider,
    )
    error_message = "var.default_provider must be one of: workers-ai, openai, anthropic, google, openrouter."
  }
}

variable "workers_ai_model" {
  description = <<-EOT
    TYPE: Required string (has default).
    PURPOSE: Model id passed to the Cloudflare Workers AI API
    when default_provider == "workers-ai". Any model id
    supported in the target Cloudflare account's region is
    valid; the default is the most commonly available Llama 3
    variant.

    Default: "@cf/meta/llama-3-8b-instruct".
  EOT
  type        = string
  default     = "@cf/meta/llama-3-8b-instruct"

  validation {
    condition     = can(regex("^@[^/]+/.+$", var.workers_ai_model))
    error_message = "var.workers_ai_model must match the Workers AI form: \"@<org>/<model>\"."
  }
}

# ------------------------------------------------------------
# Cross-worker service URL resolution
# ------------------------------------------------------------

variable "cloudflare_account_id_or_workers_dev" {
  description = <<-EOT
    TYPE: Required string. Sensitive: true (because the
    subdomain uniquely identifies the account and is a
    semi-private deployment fingerprint).
    PURPOSE: Workers.dev subdomain prefix for the target
    Cloudflare account, used to construct internal
    cross-worker service URLs. For example, if the user
    service is reachable at
    https://decision-user-service.myteam-a1b2.workers.dev
    then this variable's value is the literal string
    "myteam-a1b2".

    Where to find it: Cloudflare Dashboard → Workers & Pages
    → Overview → right-hand column, card title "Subdomain".

    Delivery: TF_VAR_cloudflare_account_id_or_workers_dev
    environment variable (GitHub Actions Secret:
    TF_VAR_cloudflare_account_id_or_workers_dev).
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[a-z0-9-]{4,}$", var.cloudflare_account_id_or_workers_dev))
    error_message = "var.cloudflare_account_id_or_workers_dev must be a valid Workers.dev subdomain prefix (4+ lowercase letters, digits, or hyphens)."
  }
}
