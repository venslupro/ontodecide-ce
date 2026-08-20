# ============================================================
# Backblaze B2 buckets: ingestion staging + tenant archive.
#
# B2 implements the S3-compatible API, so we use the standard
# AWS S3 bucket resource with the B2 S3 endpoint. B2 buckets
# are created/managed via the S3 API (no separate B2 Terraform
# provider needed).
#
# Two buckets per environment:
#   1. ingestion-staging — transient upload area for the
#      Ingestion Service (files are deleted after ETL completes)
#   2. tenant-archive    — long-term metadata archive for users
#      whose retention period has expired. The Cleanup Service
#      writes user metadata snapshots here BEFORE deleting the
#      user account and all their data.
#
# B2 S3 endpoint format:
#   https://s3.<region>.backblazeb2.com
# where <region> is the B2 region code (e.g. us-west-004).
#
# Credentials are provided via B2_APPLICATION_KEY_ID /
# B2_APPLICATION_KEY environment variables (S3 SDK standard),
# which are mapped from TF_VAR_b2_application_key_id /
# TF_VAR_b2_application_key in the GitHub Actions workflow.
# ============================================================

# ------------------------------------------------------------
# B2 connection config — passed via variables, not hard-coded.
# ------------------------------------------------------------

variable "b2_region" {
  description = <<-EOT
    Backblaze B2 region code for the S3-compatible endpoint.
    Example: "us-west-004", "eu-central-003".
    Find it in the B2 dashboard → Buckets → bucket details.
  EOT
  type        = string
}

variable "b2_application_key_id" {
  description = "B2 application key ID (S3-compatible access key). Pass via TF_VAR_b2_application_key_id."
  type        = string
  sensitive   = true
}

variable "b2_application_key" {
  description = "B2 application key (S3-compatible secret key). Pass via TF_VAR_b2_application_key."
  type        = string
  sensitive   = true
}

# ------------------------------------------------------------
# S3 provider for B2 — uses the AWS S3 provider pointed at B2.
# ------------------------------------------------------------
# Terraform does not have a native Backblaze B2 provider in the
# official registry. The cleanest approach is to use the AWS S3
# provider with B2's S3-compatible endpoint. This is the exact
# pattern recommended by Backblaze for Terraform:
#   https://www.backblaze.com/docs/cloud-storage-integrate-b2-with-terraform

provider "aws" {
  alias                       = "b2"
  region                      = var.b2_region
  access_key                  = var.b2_application_key_id
  secret_key                  = var.b2_application_key
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    s3 = "https://s3.${var.b2_region}.backblazeb2.com"
  }
}

# ------------------------------------------------------------
# Bucket 1: Ingestion staging area.
# Files are uploaded here by the Ingestion Service, processed
# by the queue consumer, then deleted. Lifecycle rule auto-
# deletes objects after 7 days as a safety net.
# ------------------------------------------------------------
resource "aws_s3_bucket" "ingestion_staging" {
  provider = aws.b2
  bucket   = "${var.project_name}-ingestion-staging-${var.environment}"
}

resource "aws_s3_bucket_lifecycle_configuration" "ingestion_staging" {
  provider = aws.b2
  bucket   = aws_s3_bucket.ingestion_staging.id

  rule {
    id     = "auto-delete-after-7-days"
    status = "Enabled"

    expiration {
      days = 7
    }
  }
}

# ------------------------------------------------------------
# Bucket 2: Tenant archive (backup).
# User metadata snapshots are written here when a user's
# retention period expires. Objects are kept indefinitely
# (compliance archive — manual deletion only).
# ------------------------------------------------------------
resource "aws_s3_bucket" "tenant_archive" {
  provider = aws.b2
  bucket   = "${var.project_name}-tenant-archive-${var.environment}"
}

# Versioning on the archive bucket for compliance.
resource "aws_s3_bucket_versioning" "tenant_archive" {
  provider = aws.b2
  bucket   = aws_s3_bucket.tenant_archive.id

  versioning_configuration {
    status = "Enabled"
  }
}
