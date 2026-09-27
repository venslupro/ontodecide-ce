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
    Apex domain of an existing Cloudflare zone (TF_VAR_domain from the GitHub
    variable APP_DOMAIN), e.g. example.com. The app is served at
    https://app.<domain>. Empty: no zone resources; the app stays on
    https://ontodecide-ce.pages.dev (Pages Functions proxy fallback).
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.domain == "" || can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.domain))
    error_message = "domain must be empty or a lowercase apex domain such as example.com."
  }
}

variable "dmarc_policy" {
  description = "DMARC policy tag value (start with none, tighten to quarantine after two weeks of reports)."
  type        = string
  default     = "none"

  validation {
    condition     = contains(["none", "quarantine", "reject"], var.dmarc_policy)
    error_message = "dmarc_policy must be none, quarantine or reject."
  }
}

variable "mail_dns_records" {
  description = <<-EOT
    Sender-domain records for Resend and Brevo (DKIM, SPF, verification TXT,
    bounce MX), copied from their dashboards. name is relative to the zone
    ("@" for the apex) or fully qualified; TXT content without quotes.
  EOT
  type = list(object({
    name     = string
    type     = string
    content  = string
    priority = optional(number)
  }))
  default = []

  validation {
    condition     = alltrue([for r in var.mail_dns_records : contains(["TXT", "CNAME", "MX"], r.type)])
    error_message = "mail_dns_records type must be TXT, CNAME or MX."
  }
}

variable "manage_apex_record" {
  description = "Create a proxied placeholder AAAA record (100::) for the apex so the 301 redirect to the app host can run. Disable when the apex already has records."
  type        = bool
  default     = true
}
