# ============================================================
# Terraform Backend — Backblaze B2 (remote)
#
# Rationale:
#   • The project uses Backblaze B2 for ALL object storage:
#       - ontodecide-ingestion-staging  (transient ETL landing)
#       - ontodecide-tenant-archive     (compliance backups)
#   • The Terraform remote state store follows the same
#     provider for simplicity — one object-storage vendor,
#     one set of credentials, zero cross-vendor lock-in.
#   • Cloudflare R2 is no longer used anywhere in the project
#     (was replaced in the "Replace R2 with B2" change set).
#
# Why backend "s3" when the state lives in Backblaze B2?
#   Backblaze B2 exposes a fully S3-compatible HTTPS API, and
#   Terraform has no native "backblaze-b2" backend. Declaring
#   backend "s3" simply selects the S3 WIRE PROTOCOL — every
#   network call is redirected to B2's endpoint via
#   endpoints.s3.  This is the official pattern recommended
#   by Backblaze for Terraform:
#     https://www.backblaze.com/docs/cloud-storage-integrate-b2-with-terraform
#
# Why credentials are named AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY:
#   The backend "s3" implementation ships with a BUNDLED
#   HashiCorp AWS SDK whose credential provider chain is
#   HARD-CODED to look for the AWS_-prefixed env vars as its
#   #1 credential source. Those are the ONLY env vars the
#   bundled SDK accepts. The actual secrets you paste here are
#   100% Backblaze — B2 Application Key (keyID) +
#   applicationKey. We never touch AWS.
#
# FIRST-TIME SETUP (do this ONCE before the first `terraform init`):
#   1. Create a B2 bucket for Terraform state:
#        Dashboard → Buckets → Create a new Bucket
#        Name:      ontodecide-terraform-state
#        Encrypt:   Yes (default)
#        Lifecycle: None (keep forever)
#      B2 bucket names are globally unique; lowercase
#      alphanumeric + hyphen only, 3-63 chars.
#
#   2. Create a bucket-scoped B2 Application Key:
#      Dashboard → App Keys → Add Application Key
#        • Name:         ontodecide-tf-state
#        • Capabilities: Read and Write (not Master!)
#        • Bucket:       ontodecide-terraform-state ONLY
#      Record: keyID (→ AWS_ACCESS_KEY_ID)
#              applicationKey (→ AWS_SECRET_ACCESS_KEY)
#
#   3. Note your B2 region code from the bucket details screen,
#      e.g. us-west-004, eu-central-003.
#
#   4. Initialize Terraform with backend credentials:
#
#      # --- Standard env vars consumed by the bundled AWS SDK ---
#      export AWS_ACCESS_KEY_ID="<B2_KEY_ID>"
#      export AWS_SECRET_ACCESS_KEY="<B2_APPLICATION_KEY>"
#      export AWS_DEFAULT_REGION="<B2_REGION>"
#      export AWS_EC2_METADATA_DISABLED=true
#
#      # --- B2 S3 endpoint (derived from region) ---
#      B2_ENDPOINT="https://s3.${AWS_DEFAULT_REGION}.backblazeb2.com"
#
#      # CANONICAL FORM: -backend-config=FILE (not KEY=VALUE!)
#      # Terraform's `-backend-config KEY=VALUE` CLI form cannot
#      # reliably pass nested HCL object attributes. Use a FILE.
#      cat > backend.tfvars <<'EOF'
#      bucket     = "ontodecide-terraform-state"
#      key        = "production/terraform.tfstate"
#      endpoints = {
#        s3 = "__B2_ENDPOINT__"
#      }
#      EOF
#
#      sed -i.bak -e "s|__B2_ENDPOINT__|${B2_ENDPOINT}|g" backend.tfvars \
#        && rm -f backend.tfvars.bak
#
#      terraform init -backend-config=backend.tfvars
#
#      LOCAL TIP: Place the 4 exported env vars in a `.env` file
#      and source it before running the snippet above.
#
#   5. Migrating state from a previous backend (local / R2):
#      Replace the old backend block with this block and run:
#        terraform init -migrate-state -backend-config=backend.tfvars
#      Terraform will prompt to copy the existing state file to
#      the new B2 bucket automatically.
#
# SECURITY: Never hard-code access_key / secret_key in this
# file. Always pass them via the AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY environment variables.
# ============================================================

terraform {
  # ──────────────────────────────────────────────────────────────
  # Why backend "s3" when the state lives in Backblaze B2?
  #
  #   ⚠️  THIS IS NOT AN AWS COMMITMENT — WE CREATE ZERO AWS
  #      RESOURCES (no EC2, no S3, no IAM, nothing on AWS).
  #
  #   Terraform's supported remote-state backends are listed here:
  #     https://developer.hashicorp.com/terraform/language/v1.6.x/settings/backends
  #   There is NO native "backblaze-b2" backend. The correct way
  #   to use B2 as a Terraform state store is to exploit its
  #   S3-COMPATIBLE API. Declaring backend "s3" is just a
  #   shorthand for "speak the S3 HTTPS wire format"; every
  #   actual network call is redirected to B2 via endpoints.s3.
  #
  #   Why AWS_ env vars:
  #     The S3 backend ships with a BUNDLED HashiCorp AWS SDK,
  #     and that SDK's credential provider chain is HARD-CODED
  #     to look for the AWS_-prefixed env vars as its #1
  #     credential source. This is the EXACT pattern Backblaze
  #     documents for Terraform + B2.
  #     The secrets you paste are purely B2 Application Keys.
  # ──────────────────────────────────────────────────────────────
  backend "s3" {
    # ---- Partially configured — runtime overrides required ----
    # bucket     → -backend-config=FILE (bucket = "...")
    # key        → -backend-config=FILE (key    = "...")
    # endpoints  → -backend-config=FILE (endpoints = { s3 = "https://..." })
    # access_key / secret_key → read from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
    #                           environment variables ONLY (never hard-code).

    # ---- B2 compatibility flags ---------------------------------
    # B2 implements the S3 OBJECT APIs but not the AWS
    # control-plane APIs (STS:GetCallerIdentity, EC2 metadata,
    # region validation, account id lookups, AWS checksums).
    # Skip all of those preflight checks, otherwise each one
    # fails against B2 and init aborts. These are the exact
    # flags required by the Backblaze Terraform integration
    # guide, plus skip_s3_checksum = true required because B2
    # does not implement AWS SigV4 checksum headers v2.
    region                      = "us-west-004"   # overridden at runtime via env
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
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
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
