terraform {
  required_version = ">= 1.9.0"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # v5 is a ground-up rewrite (OpenAPI code generation). The 4.x line
      # stopped at 4.52.7 — there was no 4.56 release, so the old
      # ">= 4.56" constraint matched zero registry versions and broke
      # terraform init. v5.19+ ships automatic state upgraders that
      # transparently migrate v4 state on first plan/apply.
      # Also: Cloudflare deprecated the legacy Workers KV REST API path
      # (/workers/namespaces) on 2026-07-15; it breaks 2026-10-15.
      # v5 uses the new /storage/kv/namespaces path.
      version = "~> 5.19"
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
