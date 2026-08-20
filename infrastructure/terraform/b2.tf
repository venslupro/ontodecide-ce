# ============================================================
# Backblaze B2 buckets: ingestion staging + tenant archive.
#
# STANDARD: Google Cloud Terraform Style Guide
#   https://cloud.google.com/docs/terraform/best-practices
#
# Key rules enforced in this file:
#   1. Every input variable has a `validation` block with an
#      actionable, human-readable error_message.
#   2. Description strings follow the canonical form
#      "TYPE: ...  PURPOSE: ...  [Default: ...]."
#   3. Secret strings carry `sensitive = true` and are never
#      defaulted.
#   4. Outputs are named consistently and include descriptions.
#   5. Region / endpoint strings are validated against the
#      documented B2 formats, never accepted blindly.
#
# B2 implements the S3-compatible HTTPS API. We use the
# standard AWS S3 provider pointed at B2's endpoint, which is
# the exact pattern recommended by Backblaze:
#   https://www.backblaze.com/docs/cloud-storage-integrate-b2-with-terraform
#
# Two business-data buckets per environment:
#   1. ingestion-staging — transient upload area for the
#      Ingestion Service. Files are deleted after the queue
#      consumer finishes ETL; a 7-day lifecycle rule acts as
#      an automatic safety net.
#   2. tenant-archive    — long-term compliance archive for
#      users whose retention period has expired. The Cleanup
#      Service writes a metadata snapshot here BEFORE the
#      DROP DATABASE and D1 row removal commands are issued.
#      Objects are kept indefinitely (versioning enabled).
#
# Terraform remote-state bucket is NOT managed here. The state
# bucket must be created manually BEFORE the first
# `terraform init` because Terraform needs a store to write
# state INTO before it can manage resources. See main.tf for
# the one-time B2 state-bucket setup instructions.
# ============================================================

# ------------------------------------------------------------
# Input variables
# ------------------------------------------------------------

variable "b2_region" {
  description = <<-EOT
    TYPE: Required string.
    PURPOSE: Backblaze B2 region code for both the
    business-data buckets (ingestion-staging + tenant-archive)
    managed in this file AND the S3-compatible HTTPS endpoint
    used by the aws.b2 provider. The value comes from the
    Backblaze B2 dashboard: open a bucket's details screen and
    copy the "Region" field exactly.

    Accepted format: ^[a-z]{2}-[a-z]+-[0-9]{3}$ (e.g.
    "us-west-004", "eu-central-003").

    Delivery: TF_VAR_b2_region environment variable (GitHub
    Actions Variable: TF_VAR_b2_region).
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]{3}$", var.b2_region))
    error_message = "var.b2_region must match the B2 region code format ^[a-z]{2}-[a-z]+-[0-9]{3}$ (examples: \"us-west-004\", \"eu-central-003\"). Copy the exact \"Region\" value from the B2 dashboard → bucket details."
  }
}

variable "b2_application_key_id" {
  description = <<-EOT
    TYPE: Required secret string. Sensitive: true.
    PURPOSE: Backblaze B2 Application Key keyID used for the
    two business-data buckets (ingestion-staging +
    tenant-archive).  The value is the literal "keyID" string
    shown on the B2 App Keys creation screen.

    Capabilities required (B2 App Keys dialog):
      • Bucket access: "Allow access to only the following
        buckets" → select BOTH
        ontodecide-ingestion-staging-<env> AND
        ontodecide-tenant-archive-<env>.
      • Permissions: Read and Write.
      • File name prefix: leave empty (full-bucket access).

    This key is used ONLY for business-data buckets. A
    SEPARATE, bucket-scoped key for the Terraform state
    backend (ontodecide-terraform-state) must be configured as
    the GitHub Secrets TF_B2_STATE_KEY_ID /
    TF_B2_STATE_APPLICATION_KEY.

    Rotation: create a second B2 App Key with the same scope,
    update the GitHub Secret, deploy once, then disable the
    old key. No downtime because the key is consumed fresh on
    every Terraform operation.

    Delivery: TF_VAR_b2_application_key_id environment
    variable (GitHub Actions Secret:
    TF_VAR_b2_application_key_id).
  EOT
  type        = string
  sensitive   = true

  validation {
    condition = (
      var.b2_application_key_id != "" &&
      can(regex("^[A-Za-z0-9]{10,}$", var.b2_application_key_id))
    )
    error_message = "var.b2_application_key_id must be a non-empty B2 Application Key keyID (>= 10 alphanumeric characters). Copy it from B2 Dashboard → App Keys."
  }
}

variable "b2_application_key" {
  description = <<-EOT
    TYPE: Required secret string. Sensitive: true.
    PURPOSE: Backblaze B2 Application Key (secret portion)
    corresponding to var.b2_application_key_id. The value is
    the literal "applicationKey" string shown exactly once at
    App Key creation time — if lost, create a new key.

    Rotation: paired with var.b2_application_key_id; rotate
    both values together.

    Delivery: TF_VAR_b2_application_key environment variable
    (GitHub Actions Secret: TF_VAR_b2_application_key).
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = var.b2_application_key != "" && length(var.b2_application_key) >= 16
    error_message = "var.b2_application_key must be a non-empty B2 Application Key secret (>= 16 chars). The secret is shown only once at App Key creation time; if lost, create a new App Key."
  }
}

# ------------------------------------------------------------
# S3 provider configured for Backblaze B2.
#
# The `alias = "b2"` is used so that the business-data buckets
# declared below (aws_s3_bucket.ingestion_staging etc.) route
# to B2 instead of Amazon S3, while leaving other potential
# future AWS uses untouched. The required_providers entry for
# hashicorp/aws lives in main.tf.
# ------------------------------------------------------------

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
# Files are uploaded by the Ingestion Service, processed by
# the queue consumer, then explicitly deleted. The 7-day
# lifecycle rule auto-deletes any object that was not cleaned
# up by the application path (e.g. transient failures that
# never made it into the dead-letter queue).
# ------------------------------------------------------------
resource "aws_s3_bucket" "ingestion_staging" {
  provider = aws.b2
  bucket   = "${var.project_name}-ingestion-staging-${var.environment}"

  tags = {
    Environment = var.environment
    Project     = var.project_name
    Service     = "ingestion"
    Lifecycle   = "transient (max 7 days)"
  }
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
# Bucket 2: Tenant archive (long-term compliance backup).
# User metadata snapshots (D1 rows + audit-log excerpts) are
# written here by the Cleanup Service for every user whose
# retention period has expired.  Objects in this bucket are
# the authoritative compliance record and MUST outlive the
# original account. Versioning is enabled to prevent any
# accidental or malicious overwrite. Manual deletion only.
# ------------------------------------------------------------
resource "aws_s3_bucket" "tenant_archive" {
  provider = aws.b2
  bucket   = "${var.project_name}-tenant-archive-${var.environment}"

  tags = {
    Environment = var.environment
    Project     = var.project_name
    Service     = "cleanup"
    Lifecycle   = "permanent (compliance archive)"
  }
}

resource "aws_s3_bucket_versioning" "tenant_archive" {
  provider = aws.b2
  bucket   = aws_s3_bucket.tenant_archive.id

  versioning_configuration {
    status = "Enabled"
  }
}

# ------------------------------------------------------------
# Outputs — referenced by Worker resources in workers.tf.
# ------------------------------------------------------------

output "b2_ingestion_staging_bucket_name" {
  description = "Name of the Backblaze B2 bucket used as transient ETL landing zone (Cleanup/Ingestion workers access it via the B2 S3-compatible API)."
  value       = aws_s3_bucket.ingestion_staging.id
}

output "b2_tenant_archive_bucket_name" {
  description = "Name of the Backblaze B2 bucket used as long-term compliance archive (Cleanup worker writes user-metadata snapshots here before deleting accounts)."
  value       = aws_s3_bucket.tenant_archive.id
}

output "b2_region" {
  description = "Backblaze B2 region code used by the business-data buckets (mirrors var.b2_region). Included in Worker env bindings so the runtime can build the S3 endpoint without further configuration."
  value       = var.b2_region
}
