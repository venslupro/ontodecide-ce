# ============================================================================
# Input variables — naming aligned with deploy-service.yml / migrate.sh
#   PROJECT_NAME  <-> var.project_name   (default "ontodecide")
#   ENVIRONMENT   <-> var.environment    (default "production")
# ============================================================================

variable "account_id" {
  description = "Cloudflare account ID (32 hex). Can be injected via TF_VAR_account_id."
  type        = string
  sensitive   = true
}

variable "zone_id" {
  description = "(Optional) Cloudflare Zone ID for the custom domain. Leave empty to skip domain resource creation."
  type        = string
  default     = ""
}

variable "project_name" {
  description = "Project prefix used in all resource naming (matches migrate.sh PROJECT_NAME)."
  type        = string
  default     = "ontodecide"
}

variable "environment" {
  description = "Environment suffix. Single-environment system: production only (no preview/staging)."
  type        = string
  default     = "production"

  validation {
    condition     = var.environment == "production"
    error_message = "environment must be production (single-environment system; no preview/staging)."
  }
}

# ---- B2 / Neo4j external dependency variables (Terraform does not create them; documented + audited only) ----
# B2 bucket naming convention: ${project_name}-${env_short}-{purpose}
# (buckets are created externally; this only documents/audits to keep naming consistent)
variable "b2_region" {
  description = "Backblaze B2 S3 region, e.g. us-west-004."
  type        = string
  default     = "us-west-004"
}

variable "b2_ingestion_bucket" {
  description = "B2 data ingestion staging bucket name (used by Ingestion, archived by Cleanup). Naming: ontodecide-prd-ingestion-staging"
  type        = string
  default     = "ontodecide-prd-ingestion-staging"
}

variable "b2_archive_bucket" {
  description = "B2 tenant archive backup bucket name (used by Cleanup). Naming: ontodecide-prd-tenant-archive"
  type        = string
  default     = "ontodecide-prd-tenant-archive"
}

# ---- Terraform remote state backend (B2 S3-compatible) ----
# B2 bucket name is hardcoded statically in versions.tf backend "s3" block
# (ontodecide-prd-terraform-state); credentials are injected via env vars.

variable "neo4j_url_placeholder" {
  description = "Neo4j AuraDB connection URL placeholder. Real value injected via wrangler.toml [vars] + Dashboard variable overrides."
  type        = string
  default     = "https://REPLACE_WITH_AURADB_HOST.databases.neo4j.io"
}

variable "neo4j_user" {
  description = "Neo4j username (documentation only)."
  type        = string
  default     = "neo4j"
}

variable "neo4j_database" {
  description = "Neo4j shared DB name (property isolation + tenant_id)."
  type        = string
  default     = "neo4j"
}
