terraform {
  required_version = ">= 1.9.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
    b2 = {
      source  = "Backblaze/b2"
      version = "~> 0.14"
    }
    neo4jaura = {
      source  = "neo4j-labs/neo4jaura"
      version = "~> 1.1"
    }
  }

  # ──────────────────────────────────────────────────────────
  # Remote state backend: Backblaze B2 (S3-compatible)
  #
  # STATIC config — bucket / endpoint / region are the same
  # across environments (single B2 bucket in us-east-005).
  # Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  # env vars — preferably a key scoped to the state bucket only
  # (B2_STATE_KEY_ID / B2_STATE_KEY secrets); terraform.yml falls
  # back to B2_MASTER_KEY_ID / B2_MASTER_KEY when those are unset.
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
    bucket = "ontodecide-prd-tf-state"
    key    = "ontodecide/terraform.tfstate"
    region = "us-east-005"

    endpoints = {
      s3 = "https://s3.us-east-005.backblazeb2.com"
    }

    # State holds plaintext secrets (B2 worker key, Neo4j password).
    # encrypt = true sends x-amz-server-side-encryption: AES256, which
    # B2 maps to SSE-B2 (encryption at rest with B2-managed keys).
    encrypt = true

    # B2 is not AWS — skip all AWS-specific validations
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
  }
}
