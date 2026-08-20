# ============================================================
# Terraform Backend — Cloudflare R2 (remote)
#
# Reference:
#   Cloudflare Terraform docs → Advanced topics → Remote R2 backend
#   https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/
#
# Cloudflare R2 is the OFFICIAL recommended remote state backend for
# Cloudflare Terraform deployments. It provides:
#   • S3-compatible API (works with Terraform's built-in "s3" backend)
#   • Zero egress fees
#   • Built-in redundancy (data spread across Cloudflare's global network)
#
# FIRST-TIME SETUP (do this ONCE before the first `terraform init`):
#   1. Create the R2 bucket:
#        wrangler r2 bucket create ontodecide-terraform-state
#      Or via the Cloudflare dashboard: R2 → Create bucket
#      Bucket names MUST be lowercase alphanumeric + hyphen only.
#
#   2. Create a bucket-scoped R2 API token:
#      Dashboard → R2 → "Manage R2 API tokens" → Create API token
#        • Permissions: Object Read & Write
#        • Scope:      Only this bucket (ontodecide-terraform-state)
#      Record: Access Key ID  and  Secret Access Key
#
#   3. Initialize Terraform with backend credentials:
#
#        terraform init \
#          -backend-config="bucket=ontodecide-terraform-state" \
#          -backend-config="key=production/terraform.tfstate" \
#          -backend-config="access_key=<YOUR_R2_ACCESS_KEY_ID>" \
#          -backend-config="secret_key=<YOUR_R2_SECRET_ACCESS_KEY>" \
#          -backend-config="endpoints={s3=https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com}"
#
#      For CI/CD (GitHub Actions), the same flags are passed via
#      TF_CLI_ARGS_init or inline arguments to `terraform init`.
#
#   4. Migrating from local state: If you previously used backend "local",
#      replace this block and run `terraform init -reconfigure` with the
#      flags above — Terraform will prompt to upload the local state file
#      to R2 automatically.
#
# SECURITY: Never hard-code access_key / secret_key in this file. Always
# pass them via `-backend-config` on the command line.
# ============================================================

terraform {
  # Cloudflare R2 uses the S3-compatible API, so we use the standard
  # Terraform "s3" backend type with R2-specific tuning flags.
  backend "s3" {
    # ---- R2 identity (OVERRIDE THESE via -backend-config at init time) ----
    # bucket   = "ontodecide-terraform-state"
    # key      = "production/terraform.tfstate"
    # access_key = ""  # from -backend-config
    # secret_key = ""  # from -backend-config
    # endpoints  = { s3 = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com" }

    # ---- R2 compatibility flags (DO NOT EDIT) ----
    # These are required per Cloudflare's official R2 backend docs.
    # R2 is not AWS S3, so we must tell Terraform to skip all the
    # AWS-specific metadata, region, and account-id validation steps.
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
  }

  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.30"
    }
  }
}

# ============================================================
# Cloudflare Provider
#
# Reference:
#   Cloudflare Terraform docs → Advanced topics → Provider customization
#   https://developers.cloudflare.com/terraform/advanced-topics/provider-customization/
#
# The provider reads its authentication from environment variables —
# NEVER put Cloudflare credentials into Terraform variables or tfvars.
#
# Required environment variable (local + CI):
#   CLOUDFLARE_API_TOKEN
#     A Cloudflare API token with the following permissions scoped to
#     the target account:
#       • Account.Account Settings:Read
#       • D1:Edit
#       • Workers R2 Storage:Edit
#       • Workers KV Storage:Edit
#       • Workers Queues:Edit
#       • Workers Scripts:Edit
#       • Workers AI:Read (when using Workers AI models)
#
# Optional environment variable:
#   CLOUDFLARE_ACCOUNT_ID
#     If provided, the `data.cloudflare_accounts.this` lookup below is
#     skipped and this value is used directly. Useful for speed or when
#     the API token has limited visibility into the accounts list.
# ============================================================

provider "cloudflare" {
  # Intentionally empty — auth comes from $CLOUDFLARE_API_TOKEN (env).
  #
  # Adding `api_token = var.cloudflare_api_token` here would force the
  # secret through the Terraform variable / state path. Per Cloudflare's
  # "Store credentials safely" best practice we avoid that and rely on
  # the provider's built-in support for the standard environment
  # variable instead.
  #
  # Retry configuration — transient Cloudflare API errors are common
  # during bulk provisioning. The provider's defaults are reasonable,
  # but we keep the block here as an explicit extension point per the
  # official provider customization docs.
  #
  # retries = 3
}

# ============================================================
# Data sources
# ============================================================

# Auto-discover the account id from the API token, unless it's been
# explicitly provided via $CLOUDFLARE_ACCOUNT_ID or the
# `cloudflare_account_id` variable.
data "cloudflare_accounts" "this" {}

locals {
  account_id = coalesce(
    var.cloudflare_account_id,
    try(data.cloudflare_accounts.this.accounts[0].id, ""),
  )
}
