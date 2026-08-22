# ============================================================================
# OntoDecide — Cloudflare 长生命周期资源 IaC 清单
# Cloudflare Provider v4.52 精确 schema 对齐版
#
# 负责范围 (Shift Left · 静态资源层):
#   • D1 共享决策库 decision-db
#   • 6 个 Worker 全部 KV namespace
#   • Ingestion / Cleanup 主队列 + DLQ (DLQ 在 wrangler.toml consumer 中绑定)
#   • 6 个 Worker 的绑定骨架 / Service Bindings / tags 治理
#   • Cleanup cron trigger
#   • 可选: 自定义域名 (Workers Domain，zone_id 非空时创建)
#
# 不负责范围 (代码层 · 走 deploy-workers.yml / wrangler.toml):
#   • Worker 脚本代码版本 (Wrangler Action)
#   • [vars] 普通文本环境变量 (wrangler.toml 原生负责)
#   • Workers AI [ai] 绑定 (wrangler.toml [ai] 负责)
#   • Durable Object 类上传 — wrangler.toml [[migrations]] tag=v1 负责
#   • Queue consumer / DLQ 绑定 — wrangler.toml [[queues.consumers]] dead_letter_queue
#   • D1 迁移 SQL — scripts/migrate.sh --remote 在全部 deploy 成功后执行
#   • Backblaze B2 桶 / Neo4j AuraDB — 外部 IaC / 控制台管理 (outputs 中汇总)
# ============================================================================

# -------- 治理 metadata locals --------
# Cloudflare Provider v4.52 仅 cloudflare_workers_script 原生支持 tags
# (Set(String))；其余资源用资源名 + 注释 + outputs 摘要体现四维治理。
# --------
locals {
  tag_environment = "Environment=${var.environment}"
  tag_project     = "Project=${var.project_name}"
  tag_lifecycle   = "Lifecycle=long-lived"

  standard_tags_map = {
    Environment = var.environment
    Project     = var.project_name
    Lifecycle   = "long-lived"
  }

  workers = {
    gateway = {
      worker_name = "decision-gateway"
      service     = "gateway"
      has_db      = false
      cron        = []
    }
    user = {
      worker_name = "decision-user-service"
      service     = "user"
      has_db      = true
      cron        = []
    }
    graph = {
      worker_name = "decision-graph-service"
      service     = "graph"
      has_db      = false
      cron        = []
    }
    ingestion = {
      worker_name = "decision-ingestion-service"
      service     = "ingestion"
      has_db      = false
      cron        = []
    }
    ai = {
      worker_name = "decision-ai-service"
      service     = "ai"
      has_db      = true
      cron        = []
    }
    cleanup = {
      worker_name = "decision-cleanup-service"
      service     = "cleanup"
      has_db      = true
      cron        = ["0 3 * * *"]
    }
  }

  kv_binding_map = [
    { svc = "gateway", binding = "JWT_BLACKLIST" },
    { svc = "gateway", binding = "RATE_LIMIT" },
    { svc = "user", binding = "CACHE" },
    { svc = "graph", binding = "CACHE" },
    { svc = "ingestion", binding = "JOBS" },
    { svc = "ai", binding = "CACHE" },
    { svc = "cleanup", binding = "USER_CACHE" },
    { svc = "cleanup", binding = "GRAPH_CACHE" },
    { svc = "cleanup", binding = "INGESTION_JOBS" },
    { svc = "cleanup", binding = "AI_CACHE" },
    { svc = "cleanup", binding = "CLEANUP_JOBS" },
  ]

  gateway_service_bindings = [
    { binding = "USER_SERVICE", target = "user" },
    { binding = "GRAPH_SERVICE", target = "graph" },
    { binding = "INGESTION_SERVICE", target = "ingestion" },
    { binding = "AI_SERVICE", target = "ai" },
    { binding = "CLEANUP_SERVICE", target = "cleanup" },
  ]

  ingestion_service_bindings = [
    { binding = "GRAPH_SERVICE", target = "graph" },
  ]

  # Durable Object 类清单 (在 wrangler.toml [[migrations]] v1 中声明类代码)
  durable_object_classes = {
    AGENT = "PlanningAgent"
  }
}

# ============================================================================
# 1) D1 共享数据库: ${project_name}-decision-db-${environment}
# ============================================================================
resource "cloudflare_d1_database" "decision_db" {
  account_id = var.account_id
  name       = "${var.project_name}-decision-db-${var.environment}"
  # 治理: Environment=${var.environment} Project=${var.project_name}
  #       Service=shared Lifecycle=long-lived
}

# ============================================================================
# 2) KV Namespaces (11)
# ============================================================================
resource "cloudflare_workers_kv_namespace" "kv" {
  for_each = {
    for idx, item in local.kv_binding_map :
    "${item.svc}__${item.binding}" => item
  }

  account_id = var.account_id
  title      = "${var.project_name}-${each.value.binding}-${var.environment}"
  # 治理: Environment=${var.environment} Project=${var.project_name}
  #       Service=${each.value.svc} Lifecycle=long-lived
}

# ============================================================================
# 3) Queues: ingestion + cleanup (主 + DLQ 分别创建)
#    consumer 的 dead_letter_queue 绑定由 wrangler.toml [[queues.consumers]] 负责
# ============================================================================
resource "cloudflare_queue" "ingestion_dlq" {
  account_id = var.account_id
  name       = "${var.project_name}-ingestion-dlq-${var.environment}"
  # 治理: Environment=${var.environment} Project=${var.project_name}
  #       Service=ingestion Lifecycle=long-lived
}

resource "cloudflare_queue" "ingestion" {
  account_id = var.account_id
  name       = "${var.project_name}-ingestion-${var.environment}"
  # 治理: Environment=${var.environment} Project=${var.project_name}
  #       Service=ingestion Lifecycle=long-lived
}

resource "cloudflare_queue" "cleanup_dlq" {
  account_id = var.account_id
  name       = "${var.project_name}-cleanup-dlq-${var.environment}"
  # 治理: Environment=${var.environment} Project=${var.project_name}
  #       Service=cleanup Lifecycle=long-lived
}

resource "cloudflare_queue" "cleanup" {
  account_id = var.account_id
  name       = "${var.project_name}-cleanup-${var.environment}"
  # 治理: Environment=${var.environment} Project=${var.project_name}
  #       Service=cleanup Lifecycle=long-lived
}

# ============================================================================
# 4) Worker 绑定骨架 (metadata-only)
#    Provider v4 workers_script 不支持 ai_binding / durable_object 块；
#    因此 AI / DO / 普通 [vars] 仍由 wrangler.toml 声明。
#    这里的 content 是 sentinel；Wrangler 每次 deploy 会覆盖脚本与 vars；
#    lifecycle.ignore_changes + ignore_all_changes plain_text bindings 保证
#    Terraform apply 不会回滚 wrangler 的真实代码。
# ============================================================================
locals {
  sentinel_script = <<-EOT
  // Terraform reserved sentinel — actual code deployed via Wrangler Action.
  export default {
    fetch() {
      return new Response(
        'Sentinel: Worker metadata is managed by Terraform; code deploys via GitHub Actions + wrangler deploy.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    },
  };
  EOT
}

resource "cloudflare_workers_script" "svc" {
  for_each            = local.workers
  account_id          = var.account_id
  name                = each.value.worker_name
  content             = local.sentinel_script
  module              = true
  compatibility_date  = "2024-10-01"
  compatibility_flags = ["nodejs_compat"]

  # 四维治理标签 (Provider v4 唯一支持 tags 的资源)
  tags = [
    local.tag_environment,
    local.tag_project,
    "Service=${each.value.service}",
    local.tag_lifecycle,
  ]

  # ---- D1 ----
  dynamic "d1_database_binding" {
    for_each = each.value.has_db ? [1] : []
    content {
      name        = "DB"
      database_id = cloudflare_d1_database.decision_db.id
    }
  }

  # ---- KV ----
  dynamic "kv_namespace_binding" {
    for_each = [
      for item in local.kv_binding_map : item if item.svc == each.key
    ]
    content {
      name         = kv_namespace_binding.value.binding
      namespace_id = cloudflare_workers_kv_namespace.kv["${kv_namespace_binding.value.svc}__${kv_namespace_binding.value.binding}"].id
    }
  }

  # ---- Queue producer bindings (Ingestion / Cleanup) ----
  dynamic "queue_binding" {
    for_each = each.key == "ingestion" ? [
      { binding = "INGEST_QUEUE", queue = cloudflare_queue.ingestion.name }
      ] : each.key == "cleanup" ? [
      { binding = "CLEANUP_QUEUE", queue = cloudflare_queue.cleanup.name }
    ] : []
    content {
      binding = queue_binding.value.binding
      queue   = queue_binding.value.queue
    }
  }

  # ---- Service Bindings ----
  dynamic "service_binding" {
    for_each = concat(
      each.key == "gateway" ? local.gateway_service_bindings : [],
      each.key == "ingestion" ? local.ingestion_service_bindings : [],
    )
    content {
      name        = service_binding.value.binding
      service     = local.workers[service_binding.value.target].worker_name
      environment = var.environment
    }
  }

  # 注意:
  #   • Workers AI binding → 由 wrangler.toml [ai] 块负责 (Provider v4 无此块)
  #   • Durable Object → 由 wrangler.toml [[migrations]] tag=v1 负责
  #   • 普通 [vars] 环境变量 → 由 wrangler.toml [vars] + Dashboard Variables 覆盖

  lifecycle {
    create_before_destroy = true
    ignore_changes = [
      content,
      module,
      compatibility_date,
      compatibility_flags,
      plain_text_binding,
      secret_text_binding,
      webassembly_binding,
    ]
  }
}

# ============================================================================
# 5) Cron trigger: Cleanup 每天 03:00 UTC
#    v4 schedules = list(string) of cron expressions
# ============================================================================
resource "cloudflare_workers_cron_trigger" "cleanup_daily" {
  for_each    = length(local.workers["cleanup"].cron) > 0 ? { cleanup = "cleanup" } : {}
  account_id  = var.account_id
  script_name = local.workers["cleanup"].worker_name
  schedules   = local.workers["cleanup"].cron
  # 治理: Environment=${var.environment} Project=${var.project_name}
  #       Service=cleanup Lifecycle=long-lived
}

# ============================================================================
# 6) 可选: Workers 自定义域名
# ============================================================================
locals {
  custom_domains = {
    gateway   = "api.${var.project_name}.com"
    user      = null
    graph     = null
    ingestion = null
    ai        = null
    cleanup   = null
  }
}

resource "cloudflare_workers_domain" "svc" {
  for_each = {
    for k, d in local.custom_domains : k => d
    if d != null && var.zone_id != ""
  }

  account_id  = var.account_id
  zone_id     = var.zone_id
  hostname    = each.value
  service     = local.workers[each.key].worker_name
  environment = var.environment
  # 治理: Environment=${var.environment} Project=${var.project_name}
  #       Service=${each.key} Lifecycle=long-lived
}

# ============================================================================
# --------- apps/web (service #7) 扩展锚点 ---------
# 接入第 7 个 Worker 仅需改动以下三处，无需动结构代码：
#
# (1) local.workers 新增:
#     web = { worker_name="decision-web-service", service="web", has_db=false, cron=[] }
# (2) Gateway 如需转发到 Web，在 local.gateway_service_bindings 追加:
#     { binding="WEB_SERVICE", target="web" }
# (3) KV 缓存在 local.kv_binding_map 追加:
#     { svc="web", binding="CACHE" }
# (4) deploy-workers.yml 的 DEFAULTS_MATRIX 追加一条 web 服务条目
# ============================================================================
