variable "project" {
  description = "Project segment of every resource name ({project}-{env}-{service})."
  type        = string
  default     = "ontodecide"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]*$", var.project))
    error_message = "project must be lowercase alphanumeric without hyphens."
  }
}

variable "environment" {
  description = "Environment segment of every resource name (prd is the only deployed one)."
  type        = string
  default     = "prd"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]*$", var.environment))
    error_message = "environment must be lowercase alphanumeric without hyphens."
  }
}

variable "account_id" {
  description = "Cloudflare account id (TF_VAR_account_id)."
  type        = string
  sensitive   = true
}

variable "b2_region" {
  description = "Backblaze B2 region of the S3 endpoint."
  type        = string
  default     = "us-east-005"
}

variable "enable_neo4j" {
  description = "Create the Neo4j AuraDB Free instance."
  type        = bool
  default     = true
}

variable "neo4j_cloud_provider" {
  description = "Aura cloud provider (gcp, aws, azure)."
  type        = string
  default     = "gcp"
}

variable "neo4j_region" {
  description = "Aura region matching the provider."
  type        = string
  default     = "us-central1"
}
