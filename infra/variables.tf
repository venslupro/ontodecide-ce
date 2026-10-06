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

variable "archive_sign_active" {
  description = <<-EOT
    Which archive signing key slot (a or b) identity-access uses for new
    download links. Monthly rotation: switch the slot, apply and deploy; at
    least 7 days later (every link signed by the old key has expired) run
    `terraform apply -replace='b2_application_key.archive_sign["<old>"]'`
    so the idle slot holds a fresh key for the next rotation.
  EOT
  type        = string
  default     = "a"

  validation {
    condition     = contains(["a", "b"], var.archive_sign_active)
    error_message = "archive_sign_active must be \"a\" or \"b\"."
  }
}

variable "domain" {
  description = <<-EOT
    Apex domain whose zone already exists in the Cloudflare account
    (TF_VAR_domain from the GitHub variable APP_DOMAIN), e.g. example.com.
    The zone is owned by another project; Terraform only looks it up here,
    attaches the Pages custom domain https://ontodecide-ce.<domain> and
    bulk-redirects the pages.dev host to it. Empty: no domain resources;
    the app stays on https://ontodecide-ce.pages.dev (Pages Functions proxy
    fallback).
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.domain == "" || can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.domain))
    error_message = "domain must be empty or a lowercase apex domain such as example.com."
  }
}
