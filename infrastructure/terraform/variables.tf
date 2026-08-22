# ============================================================================
# 输入变量 —— 与 deploy-workers.yml / migrate.sh 命名约定保持一致
#   PROJECT_NAME  <-> var.project_name   (默认 "ontodecide")
#   ENVIRONMENT   <-> var.environment    (默认 "production")
# ============================================================================

variable "account_id" {
  description = "Cloudflare 账户 ID (32 hex)。可使用 TF_VAR_account_id 注入。"
  type        = string
  sensitive   = true
}

variable "zone_id" {
  description = "(可选) 自定义域名所在 Cloudflare Zone ID。留空则跳过域名资源创建。"
  type        = string
  default     = ""
}

variable "project_name" {
  description = "项目前缀，参与所有资源命名 (与 migrate.sh PROJECT_NAME 一致)。"
  type        = string
  default     = "ontodecide"
}

variable "environment" {
  description = "环境后缀 (production / staging)。预留 staging 入口，本轮默认 production。"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment 必须是 production 或 staging。"
  }
}

# ---- B2 / Neo4j 外部依赖变量 (Terraform 不直接创建，仅文档化 + 审计) ----
variable "b2_region" {
  description = "Backblaze B2 S3 region，例如 us-west-004。"
  type        = string
  default     = "us-west-004"
}

variable "b2_ingestion_bucket" {
  description = "B2 数据接入暂存桶名称 (Ingestion 使用，Cleanup 归档)。"
  type        = string
  default     = "ontodecide-ingestion-staging-production"
}

variable "b2_archive_bucket" {
  description = "B2 租户归档备份桶名称 (Cleanup 使用)。"
  type        = string
  default     = "ontodecide-tenant-archive-production"
}

variable "neo4j_url_placeholder" {
  description = "Neo4j AuraDB 连接 URL 占位符。真实值通过 wrangler.toml [vars] + Dashboard 变量覆盖注入。"
  type        = string
  default     = "https://REPLACE_WITH_AURADB_HOST.databases.neo4j.io"
}

variable "neo4j_user" {
  description = "Neo4j 用户名 (仅用于文档)。"
  type        = string
  default     = "neo4j"
}

variable "neo4j_database" {
  description = "Neo4j 单共享 DB 名称 (property isolation + tenant_id)。"
  type        = string
  default     = "neo4j"
}
