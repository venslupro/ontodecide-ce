# HashiCorp Terraform CLI + official providers. Terraform manages resources
# only; Worker code, bindings, vars and crons belong to Wrangler
# (apps/*/wrangler.jsonc.tpl rendered by scripts/gen_wrangler.mjs).
terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
    b2 = {
      source  = "Backblaze/b2"
      version = "~> 0.14"
    }
    # Only to read the forgotten V1.3 instance (legacy.tf); remove with it.
    neo4jaura = {
      source  = "neo4j-labs/neo4jaura"
      version = "~> 1.1"
    }
  }

  # State lives in the private B2 bucket ontodecide-ce-tfstate (S3 API,
  # SSE-B2, versioning; kept outside the {project}-{env}-{service} naming).
  # There is a single environment (production).
  # The only secrets in state are the bucket-scoped B2 archive keys and the
  # Turnstile secret, all marked sensitive. JWT, pepper and mail keys never
  # pass through Terraform.
  backend "s3" {
    bucket = "ontodecide-ce-tfstate"
    key    = "terraform.tfstate"
    region = "us-east-005"

    endpoints = {
      s3 = "https://s3.us-east-005.backblazeb2.com"
    }

    encrypt                     = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

provider "cloudflare" {
  # CLOUDFLARE_API_TOKEN from the environment.
}

provider "b2" {
  # B2_APPLICATION_KEY_ID / B2_APPLICATION_KEY from the environment.
}

provider "neo4jaura" {
  # Legacy (legacy.tf). AURA_CLIENT_ID / AURA_CLIENT_SECRET from the environment.
}
