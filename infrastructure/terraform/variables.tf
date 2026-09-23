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
  description = "Environment name. production→prd, staging→stg. Staging not yet in use; only production is deployed today."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be one of: production, staging."
  }
}

# ---- Backblaze B2 variables (Terraform-managed resources) ----
# B2 bucket naming convention: ${project_name}-${env_short}-{service}-{component}
# Buckets are created and managed by Terraform via the Backblaze/b2 provider.
# The state bucket (ontodecide-prd-tf-state) is NOT managed here —
# it is a bootstrap dependency for the S3 backend (chicken-and-egg).
variable "b2_region" {
  description = "Backblaze B2 S3 region, e.g. us-east-005."
  type        = string
  default     = "us-east-005"
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

# ---- Neo4j AuraDB instance variables (Terraform-managed resource) ----
# Neo4j Aura instance naming convention: ${project_name}-${env_short}-neo4j
# Instance is created and managed by Terraform via the neo4j-labs/neo4jaura provider.
# Connection details (URI, username, password) are exported as sensitive outputs
# and pushed to GitHub Secrets/Variables automatically after apply.
variable "neo4j_cloud_provider" {
  description = "Cloud provider for Neo4j Aura instance. One of: gcp, aws, azure."
  type        = string
  default     = "aws"

  validation {
    condition     = contains(["gcp", "aws", "azure"], var.neo4j_cloud_provider)
    error_message = "neo4j_cloud_provider must be one of: gcp, aws, azure."
  }
}

variable "neo4j_region" {
  description = "Region for Neo4j Aura instance. Must match the chosen cloud provider."
  type        = string
  default     = "us-east-1"
}

variable "neo4j_type" {
  description = "Neo4j Aura instance type. One of: free-db, professional-db, business-critical, enterprise-db. Defaults to free-db (AuraDB Free) — paid tiers incur charges."
  type        = string
  default     = "free-db"
}

variable "neo4j_memory" {
  description = "Memory allocated for Neo4j Aura instance (paid tiers only), e.g. 2GB, 4GB, 8GB. Leave null for free-db — the tier has a fixed size."
  type        = string
  default     = null
}

variable "neo4j_storage" {
  description = "Storage allocated for Neo4j Aura instance (paid tiers only), e.g. 4GB, 8GB, 16GB. Leave null for free-db — the tier has a fixed size."
  type        = string
  default     = null
}

variable "neo4j_version" {
  description = "Neo4j database version. Currently only '5' is supported."
  type        = string
  default     = "5"
}

# ---- Terraform remote state backend (B2 S3-compatible) ----
# B2 bucket name is hardcoded statically in versions.tf backend "s3" block
# (ontodecide-prd-tf-state); credentials are injected via env vars.
