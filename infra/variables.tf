variable "account_id" {
  description = "Cloudflare account id (TF_VAR_account_id)."
  type        = string
  sensitive   = true
}

variable "env" {
  description = "Environment: prod or staging."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging"], var.env)
    error_message = "env must be prod or staging."
  }
}

variable "b2_region" {
  description = "Backblaze B2 region of the S3 endpoint."
  type        = string
  default     = "us-east-005"
}

variable "enable_neo4j" {
  description = "Create the Neo4j AuraDB Free instance (prod only)."
  type        = bool
  default     = true
}

variable "neo4j_cloud_provider" {
  description = "Aura cloud provider (gcp, aws, azure)."
  type        = string
  default     = "aws"
}

variable "neo4j_region" {
  description = "Aura region matching the provider."
  type        = string
  default     = "us-east-1"
}
