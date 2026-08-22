# ============================================================================
# OntoDecide — Cloudflare long-lived resources IaC manifest
# Cloudflare Provider v4.52 exact schema-aligned version
#
# Scope (Shift Left · static resource layer):
#   • D1 shared database "shared-db" (shared by user/ai/cleanup)
#   • All KV namespaces for the 6 workers
#   • Ingestion / Cleanup main queues + DLQs (DLQ bindings live in wrangler.toml consumer)
#   • Binding skeletons / Service Bindings / tag governance for the 6 workers
#   • Cleanup cron trigger
#   • Optional: custom domain (Workers Domain, created when zone_id is non-empty)
#
# Out of scope (code layer · handled by deploy-workers.yml / wrangler.toml):
#   • Worker script code versions (Wrangler Action)
#   • [vars] plain-text env vars (native to wrangler.toml)
#   • Workers AI [ai] binding (handled by wrangler.toml [ai])
#   • Durable Object class upload — handled by wrangler.toml [[migrations]] tag=v1
#   • Queue consumer / DLQ binding — wrangler.toml [[queues.consumers]] dead_letter_queue
#   • D1 migration SQL — scripts/migrate.sh --remote runs after all deploys succeed
#   • Backblaze B2 buckets / Neo4j AuraDB — external IaC / console-managed (summarized in outputs)
#
# Naming convention (unified):
#   ${project_name}-${env_short}-${service}[-${suffix}]
#   Examples: ontodecide-prd-gateway, ontodecide-prd-graph, ontodecide-prd-shared-db
#             ontodecide-prd-ingestion, ontodecide-prd-ingestion-dlq
#             ontodecide-prd-gateway-jwt-blacklist (KV title lowercase + hyphens)
#
# Creation order (Service Binding dependency):
#   Tier 1 (leaf services, no service binding): user · ai · graph · cleanup
#   Tier 2 (depends on graph): ingestion
#   Tier 3 (depends on all downstreams): gateway
# ============================================================================

# -------- Governance metadata + unified naming locals --------
locals {
  tag_environment = "Environment=${var.environment}"
  tag_project     = "Project=${var.project_name}"
  tag_lifecycle   = "Lifecycle=long-lived"

  # Env short form: production→prd, staging→stg (used in resource naming)
  env_short = var.environment == "production" ? "prd" : (var.environment == "staging" ? "stg" : var.environment)

  # Unified resource name prefix: ontodecide-prd
  res_prefix = "${var.project_name}-${local.env_short}"

  workers = {
    gateway = {
      worker_name = "${local.res_prefix}-gateway"
      service     = "gateway"
      has_db      = false
      cron        = []
      tier        = 3
    }
    user = {
      worker_name = "${local.res_prefix}-user"
      service     = "user"
      has_db      = true
      cron        = []
      tier        = 1
    }
    graph = {
      worker_name = "${local.res_prefix}-graph"
      service     = "graph"
      has_db      = false
      cron        = []
      tier        = 1
    }
    ingestion = {
      worker_name = "${local.res_prefix}-ingestion"
      service     = "ingestion"
      has_db      = false
      cron        = []
      tier        = 2
    }
    ai = {
      worker_name = "${local.res_prefix}-ai"
      service     = "ai"
      has_db      = true
      cron        = []
      tier        = 1
    }
    cleanup = {
      worker_name = "${local.res_prefix}-cleanup"
      service     = "cleanup"
      has_db      = true
      cron        = ["0 3 * * *"]
      tier        = 1
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

  # Durable Object class list (class code declared in wrangler.toml [[migrations]] v1)
  durable_object_classes = {
    AGENT = "PlanningAgent"
  }

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

# ============================================================================
# 1) D1 shared database: ${res_prefix}-shared-db
#    Shared by user / ai / cleanup (has_db=true). Naming convention:
#      ${project}-${env}-shared-db   service=shared expresses cross-service sharing
#                                   suffix=db    identifies resource type
# ============================================================================
resource "cloudflare_d1_database" "shared_db" {
  account_id = var.account_id
  name       = "${local.res_prefix}-shared-db"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=shared Lifecycle=long-lived
}

# D1 resource renamed from decision_db to shared_db. Last apply failed due to
# insufficient token scope, so D1 is not in state — this moved block is a no-op;
# if state has a leftover entry, it migrates smoothly.
moved {
  from = cloudflare_d1_database.decision_db
  to   = cloudflare_d1_database.shared_db
}

# ============================================================================
# 2) KV Namespaces (11)
#    Naming convention (Cloudflare resource name / Google Cloud naming convention):
#      • title         lowercase + hyphens  e.g. ontodecide-prd-cleanup-cleanup-jobs
#      • for_each key  lowercase + double-underscore separator (TF state internal id, not a cloud resource name)
#                      e.g. cleanup__cleanup_jobs
#    Note: kv_binding_map.binding itself stays UPPER_SNAKE_CASE,
#          because it maps to the wrangler.toml binding name (JS env var env.XXX).
#          Here we only convert to lowercase via lower()/replace() at naming time.
# ============================================================================
resource "cloudflare_workers_kv_namespace" "kv" {
  for_each = {
    for idx, item in local.kv_binding_map :
    # state key lowercase (TF internal id, aligned with cloud naming convention)
    "${item.svc}__${lower(item.binding)}" => item
  }

  account_id = var.account_id
  # title is the Cloudflare resource display name; lowercase + hyphens per Cloudflare naming convention
  # (binding field keeps UPPER_SNAKE_CASE for wrangler.toml; conversion happens here only)
  title = "${local.res_prefix}-${each.value.svc}-${lower(replace(each.value.binding, "_", "-"))}"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=${each.value.svc} Lifecycle=long-lived
}

# ============================================================================
# 2b) State migration — KV for_each key migrated from UPPER_SNAKE_CASE to lowercase
#     Background: the old for_each key used the binding field verbatim (uppercase),
#     producing mixed-case state keys like cleanup__CLEANUP_JOBS.
#     The for_each key now uses lower(binding); these moved blocks explicitly
#     declare the key change so Terraform migrates state without rebuilding resources.
#     moved blocks are declarative and no-op when the old key is absent in state.
# ============================================================================
moved {
  from = cloudflare_workers_kv_namespace.kv["gateway__JWT_BLACKLIST"]
  to   = cloudflare_workers_kv_namespace.kv["gateway__jwt_blacklist"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["gateway__RATE_LIMIT"]
  to   = cloudflare_workers_kv_namespace.kv["gateway__rate_limit"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["user__CACHE"]
  to   = cloudflare_workers_kv_namespace.kv["user__cache"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["graph__CACHE"]
  to   = cloudflare_workers_kv_namespace.kv["graph__cache"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["ingestion__JOBS"]
  to   = cloudflare_workers_kv_namespace.kv["ingestion__jobs"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["ai__CACHE"]
  to   = cloudflare_workers_kv_namespace.kv["ai__cache"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["cleanup__USER_CACHE"]
  to   = cloudflare_workers_kv_namespace.kv["cleanup__user_cache"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["cleanup__GRAPH_CACHE"]
  to   = cloudflare_workers_kv_namespace.kv["cleanup__graph_cache"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["cleanup__INGESTION_JOBS"]
  to   = cloudflare_workers_kv_namespace.kv["cleanup__ingestion_jobs"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["cleanup__AI_CACHE"]
  to   = cloudflare_workers_kv_namespace.kv["cleanup__ai_cache"]
}
moved {
  from = cloudflare_workers_kv_namespace.kv["cleanup__CLEANUP_JOBS"]
  to   = cloudflare_workers_kv_namespace.kv["cleanup__cleanup_jobs"]
}

# ============================================================================
# 3) Queues: ingestion + cleanup (main + DLQ created separately)
#    consumer's dead_letter_queue binding is handled by wrangler.toml [[queues.consumers]]
# ============================================================================
resource "cloudflare_queue" "ingestion_dlq" {
  account_id = var.account_id
  name       = "${local.res_prefix}-ingestion-dlq"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=ingestion Lifecycle=long-lived
}

resource "cloudflare_queue" "ingestion" {
  account_id = var.account_id
  name       = "${local.res_prefix}-ingestion"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=ingestion Lifecycle=long-lived
}

resource "cloudflare_queue" "cleanup_dlq" {
  account_id = var.account_id
  name       = "${local.res_prefix}-cleanup-dlq"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=cleanup Lifecycle=long-lived
}

resource "cloudflare_queue" "cleanup" {
  account_id = var.account_id
  name       = "${local.res_prefix}-cleanup"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=cleanup Lifecycle=long-lived
}

# ============================================================================
# 4) Worker binding skeleton (metadata-only) — split by dependency tier
#
#    The Cloudflare API requires the target Worker of a Service Binding to exist
#    when the binding is created. A single for_each resource creates in parallel
#    and cannot guarantee ordering, so it is split into three tiers:
#
#    Tier 1 (leaf):    user · ai · graph · cleanup — no service binding
#    Tier 2:           ingestion — service_binding → graph (Tier1)
#    Tier 3:           gateway   — service_binding → 5 downstreams (Tier1 + Tier2)
#
#    Provider v4 workers_script does not support ai_binding / durable_object blocks;
#    so AI / DO / plain [vars] are still declared in wrangler.toml.
#    content is a sentinel; Wrangler overwrites the script and vars on each deploy;
#    lifecycle.ignore_changes ensures Terraform apply never rolls back wrangler's real code.
# ============================================================================

# ---- Tier 1: leaf services (user, ai, graph, cleanup) — no Service Binding ----
resource "cloudflare_workers_script" "tier1" {
  for_each = {
    for k, w in local.workers : k => w
    if w.tier == 1
  }

  account_id          = var.account_id
  name                = each.value.worker_name
  content             = local.sentinel_script
  module              = true
  compatibility_date  = "2024-10-01"
  compatibility_flags = ["nodejs_compat"]

  # 4D governance tags (the only resource supporting native tags on Provider v4)
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
      database_id = cloudflare_d1_database.shared_db.id
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

  # ---- Queue producer bindings (Cleanup only) ----
  dynamic "queue_binding" {
    for_each = each.key == "cleanup" ? [
      { binding = "CLEANUP_QUEUE", queue = cloudflare_queue.cleanup.name }
    ] : []
    content {
      binding = queue_binding.value.binding
      queue   = queue_binding.value.queue
    }
  }

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

# ---- Tier 2: ingestion — Service Binding → graph (Tier1) ----
resource "cloudflare_workers_script" "ingestion" {
  account_id          = var.account_id
  name                = local.workers["ingestion"].worker_name
  content             = local.sentinel_script
  module              = true
  compatibility_date  = "2024-10-01"
  compatibility_flags = ["nodejs_compat"]

  tags = [
    local.tag_environment,
    local.tag_project,
    "Service=ingestion",
    local.tag_lifecycle,
  ]

  # ---- KV ----
  dynamic "kv_namespace_binding" {
    for_each = [
      for item in local.kv_binding_map : item if item.svc == "ingestion"
    ]
    content {
      name         = kv_namespace_binding.value.binding
      namespace_id = cloudflare_workers_kv_namespace.kv["${kv_namespace_binding.value.svc}__${kv_namespace_binding.value.binding}"].id
    }
  }

  # ---- Queue producer binding ----
  queue_binding {
    binding = "INGEST_QUEUE"
    queue   = cloudflare_queue.ingestion.name
  }

  # ---- Service Binding → Graph (Tier1, must be created first) ----
  dynamic "service_binding" {
    for_each = local.ingestion_service_bindings
    content {
      name        = service_binding.value.binding
      service     = cloudflare_workers_script.tier1["graph"].name
      environment = var.environment
    }
  }

  # Explicit dependency: graph Worker must be created first
  depends_on = [cloudflare_workers_script.tier1["graph"]]

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

# ---- Tier 3: gateway — Service Bindings → all 5 downstreams ----
resource "cloudflare_workers_script" "gateway" {
  account_id          = var.account_id
  name                = local.workers["gateway"].worker_name
  content             = local.sentinel_script
  module              = true
  compatibility_date  = "2024-10-01"
  compatibility_flags = ["nodejs_compat"]

  tags = [
    local.tag_environment,
    local.tag_project,
    "Service=gateway",
    local.tag_lifecycle,
  ]

  # ---- KV ----
  dynamic "kv_namespace_binding" {
    for_each = [
      for item in local.kv_binding_map : item if item.svc == "gateway"
    ]
    content {
      name         = kv_namespace_binding.value.binding
      namespace_id = cloudflare_workers_kv_namespace.kv["${kv_namespace_binding.value.svc}__${kv_namespace_binding.value.binding}"].id
    }
  }

  # ---- Service Bindings → 5 downstreams (Tier1 + Tier2 must be created first) ----
  dynamic "service_binding" {
    for_each = local.gateway_service_bindings
    content {
      name = service_binding.value.binding
      # ingestion is in Tier2, the rest in Tier1
      service     = service_binding.value.target == "ingestion" ? cloudflare_workers_script.ingestion.name : cloudflare_workers_script.tier1[service_binding.value.target].name
      environment = var.environment
    }
  }

  # Explicit dependency: all Tier1 + ingestion must be created first
  depends_on = [
    cloudflare_workers_script.tier1,
    cloudflare_workers_script.ingestion,
  ]

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
# 5) Cron trigger: Cleanup daily at 03:00 UTC
#    v4 schedules = list(string) of cron expressions
# ============================================================================
resource "cloudflare_workers_cron_trigger" "cleanup_daily" {
  for_each    = length(local.workers["cleanup"].cron) > 0 ? { cleanup = "cleanup" } : {}
  account_id  = var.account_id
  script_name = local.workers["cleanup"].worker_name
  schedules   = local.workers["cleanup"].cron

  # cleanup Worker (Tier1) must exist first; cron trigger references its worker_name
  depends_on = [cloudflare_workers_script.tier1["cleanup"]]
}

# ============================================================================
# 6) Optional: Workers custom domain
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
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=${each.key} Lifecycle=long-lived

  # The corresponding Worker must be created first
  depends_on = [cloudflare_workers_script.gateway]
}

# ============================================================================
# --------- apps/web (service #7) extension anchor ---------
# Adding a 7th Worker only requires these four edits — no structural refactor:
#
# (1) Add to local.workers:
#     web = { worker_name="${local.res_prefix}-web", service="web", has_db=false, cron=[], tier=1 }
# (2) If Gateway should forward to Web, append to local.gateway_service_bindings:
#     { binding="WEB_SERVICE", target="web" }
# (3) Append KV cache to local.kv_binding_map:
#     { svc="web", binding="CACHE" }
# (4) Append a web entry to DEFAULTS_MATRIX in deploy-workers.yml
# ============================================================================
