terraform {
  required_version = ">= 1.9.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }

  # ──────────────────────────────────────────────────────────
  # Remote state backend: Backblaze B2 (S3-compatible)
  #
  # STATIC config — bucket / endpoint / region are the same
  # across environments (single B2 bucket in us-east-005).
  # Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  # env vars (reusing B2_KEY_ID / B2_KEY GitHub secrets).
  #
  # To override (e.g. different bucket), create a local
  # backend_override.tf (gitignored via *_override.tf pattern).
  #
  # skip_requesting_account_id is CRITICAL: B2 keys are not AWS
  # credentials, so STS GetCallerIdentity fails — this flag skips
  # that check entirely.
  #
  # This ensures state persists across CI runs so that:
  #   • `terraform plan` shows real diff (not "+create" for all)
  #   • `terraform apply` doesn't fail on "resource already exists"
  # ──────────────────────────────────────────────────────────
  backend "s3" {
    bucket = "ontodecide-prd-terraform-state"
    key    = "ontodecide/terraform.tfstate"
    region = "us-east-005"

    endpoints = {
      s3 = "https://s3.us-east-005.backblazeb2.com"
    }

    # B2 is not AWS — skip all AWS-specific validations
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
  }
}
