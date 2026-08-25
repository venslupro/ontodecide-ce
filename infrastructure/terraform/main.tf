# ============================================================================
# OntoDecide — Cloudflare long-lived resources IaC manifest
# Cloudflare Provider schema (unified bindings, object attrs)
#
# Scope (Shift Left · static resource layer):
#   • D1 shared database "shared-db" (shared by user/ai/cleanup)
#   • All KV namespaces for the 6 workers
#   • Ingestion / Cleanup main queues + DLQs (DLQ bindings live in wrangler.toml consumer)
#   • Binding skeletons / Service Bindings / tag governance for the 6 workers
#   • Cleanup cron trigger
#   • Optional: custom domain (Workers Domain, created when zone_id is non-empty)
#
# Out of scope (code layer · handled by deploy-service.yml / wrangler.toml):
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
# Single-environment system: production only — no preview/staging environments.
#
# Creation order (Service Binding dependency):
#   Tier 1 (leaf services, no service binding): user · ai · graph · cleanup
#   Tier 2 (depends on graph): ingestion
#   Tier 3 (depends on all downstreams): gateway
# ============================================================================

# -------- Unified naming locals --------
locals {
  # Env short form: production→prd (single-environment system; no staging/preview)
  env_short = "prd"

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
    { svc = "ingestion", binding = "JOBS" },
    { svc = "cleanup", binding = "USER_CACHE" },
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

# ============================================================================
# 2) KV Namespaces (9)
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
# 3) Queues: ingestion + cleanup (main + DLQ created separately)
#    consumer's dead_letter_queue binding is handled by wrangler.toml [[queues.consumers]]
# ============================================================================
resource "cloudflare_queue" "ingestion_dlq" {
  account_id = var.account_id
  queue_name = "${local.res_prefix}-ingestion-dlq"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=ingestion Lifecycle=long-lived
}

resource "cloudflare_queue" "ingestion" {
  account_id = var.account_id
  queue_name = "${local.res_prefix}-ingestion"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=ingestion Lifecycle=long-lived
}

resource "cloudflare_queue" "cleanup_dlq" {
  account_id = var.account_id
  queue_name = "${local.res_prefix}-cleanup-dlq"
  # Governance: Environment=${var.environment} Project=${var.project_name}
  #             Service=cleanup Lifecycle=long-lived
}

resource "cloudflare_queue" "cleanup" {
  account_id = var.account_id
  queue_name = "${local.res_prefix}-cleanup"
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
#    workers_script uses a unified bindings list; AI / DO / plain [vars]
#    are still declared in wrangler.toml.
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
  script_name         = each.value.worker_name
  content             = local.sentinel_script
  main_module         = "index.js"
  compatibility_date  = "2024-10-01"
  compatibility_flags = ["nodejs_compat"]

  # Workers Observability: enabled at script-level scope.
  # Observability is SOLELY managed by Terraform (not wrangler.toml) per
  # project policy. Full nested logs block is required for the Cloudflare
  # Dashboard to surface "Observability: Enabled"; a bare enabled=true
  # without logs.enabled is insufficient.
  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled            = true
      invocation_logs    = true
      destinations       = ["cloudflare"]
      head_sampling_rate = 1
      persist            = true
    }
  }

  # ---- Unified bindings (all binding types in a single list) ----
  # D1 + KV + Queue producer (cleanup only). Service bindings are absent
  # in Tier 1 (leaf services). Wrangler overwrites bindings on each deploy;
  # bindings is in ignore_changes so Terraform won't fight wrangler.
  #
  # NOTE: observability is intentionally NOT listed in ignore_changes so
  # that Terraform retains ownership. If a future wrangler deploy's PUT
  # resets observability, the next `terraform plan` will flag drift and
  # `terraform apply` will restore the desired state.
  bindings = concat(
    # D1 (user, ai, cleanup)
    each.value.has_db ? [{
      name        = "DB"
      type        = "d1"
      database_id = cloudflare_d1_database.shared_db.id
    }] : [],
    # KV — binding NAME stays UPPER_SNAKE_CASE for wrangler.toml
    [
      for item in local.kv_binding_map : {
        name         = item.binding
        type         = "kv_namespace"
        namespace_id = cloudflare_workers_kv_namespace.kv["${item.svc}__${lower(item.binding)}"].id
      }
      if item.svc == each.key
    ],
    # Queue producer (cleanup only)
    each.key == "cleanup" ? [{
      name       = "CLEANUP_QUEUE"
      type       = "queue"
      queue_name = cloudflare_queue.cleanup.queue_name
    }] : []
  )

  lifecycle {
    create_before_destroy = true
    ignore_changes = [
      content,
      main_module,
      compatibility_date,
      compatibility_flags,
      bindings,
    ]
  }
}

# ---- Tier 2: ingestion — Service Binding → graph (Tier1) ----
resource "cloudflare_workers_script" "ingestion" {
  account_id          = var.account_id
  script_name         = local.workers["ingestion"].worker_name
  content             = local.sentinel_script
  main_module         = "index.js"
  compatibility_date  = "2024-10-01"
  compatibility_flags = ["nodejs_compat"]

  # Workers Observability: enabled (Terraform-only managed).
  # Full logs block required for Dashboard to show "Enabled".
  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled            = true
      invocation_logs    = true
      destinations       = ["cloudflare"]
      head_sampling_rate = 1
      persist            = true
    }
  }

  # ---- Unified bindings ----
  # KV + Queue producer + Service Binding → Graph (Tier1)
  bindings = concat(
    # KV
    [
      for item in local.kv_binding_map : {
        name         = item.binding
        type         = "kv_namespace"
        namespace_id = cloudflare_workers_kv_namespace.kv["${item.svc}__${lower(item.binding)}"].id
      }
      if item.svc == "ingestion"
    ],
    # Queue producer
    [{
      name       = "INGEST_QUEUE"
      type       = "queue"
      queue_name = cloudflare_queue.ingestion.queue_name
    }],
    # Service Binding → Graph (Tier1, must be created first)
    [
      for sb in local.ingestion_service_bindings : {
        name        = sb.binding
        type        = "service"
        service     = cloudflare_workers_script.tier1["graph"].script_name
        environment = var.environment
      }
    ]
  )

  # Explicit dependency: graph Worker must be created first
  depends_on = [cloudflare_workers_script.tier1["graph"]]

  lifecycle {
    create_before_destroy = true
    # observability intentionally NOT ignored (Terraform-owned, drift corrected)
    ignore_changes = [
      content,
      main_module,
      compatibility_date,
      compatibility_flags,
      bindings,
    ]
  }
}

# ---- Tier 3: gateway — Service Bindings → all 5 downstreams ----
resource "cloudflare_workers_script" "gateway" {
  account_id          = var.account_id
  script_name         = local.workers["gateway"].worker_name
  content             = local.sentinel_script
  main_module         = "index.js"
  compatibility_date  = "2024-10-01"
  compatibility_flags = ["nodejs_compat"]

  # Workers Observability: enabled (Terraform-only managed).
  # Full logs block required for Dashboard to show "Enabled".
  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled            = true
      invocation_logs    = true
      destinations       = ["cloudflare"]
      head_sampling_rate = 1
      persist            = true
    }
  }

  # ---- Unified bindings ----
  # KV + Service Bindings → 5 downstreams (Tier1 + Tier2 must be created first)
  bindings = concat(
    # KV
    [
      for item in local.kv_binding_map : {
        name         = item.binding
        type         = "kv_namespace"
        namespace_id = cloudflare_workers_kv_namespace.kv["${item.svc}__${lower(item.binding)}"].id
      }
      if item.svc == "gateway"
    ],
    # Service Bindings → 5 downstreams
    [
      for sb in local.gateway_service_bindings : {
        name = sb.binding
        type = "service"
        # ingestion is in Tier2, the rest in Tier1
        service     = sb.target == "ingestion" ? cloudflare_workers_script.ingestion.script_name : cloudflare_workers_script.tier1[sb.target].script_name
        environment = var.environment
      }
    ]
  )

  # Explicit dependency: all Tier1 + ingestion must be created first
  depends_on = [
    cloudflare_workers_script.tier1,
    cloudflare_workers_script.ingestion,
  ]

  lifecycle {
    create_before_destroy = true
    # observability intentionally NOT ignored (Terraform-owned, drift corrected)
    ignore_changes = [
      content,
      main_module,
      compatibility_date,
      compatibility_flags,
      bindings,
    ]
  }
}

# ============================================================================
# 5) Cron trigger: Cleanup daily at 03:00 UTC
#    schedules = list(string) of cron expressions
# ============================================================================
resource "cloudflare_workers_cron_trigger" "cleanup_daily" {
  for_each    = length(local.workers["cleanup"].cron) > 0 ? { cleanup = "cleanup" } : {}
  account_id  = var.account_id
  script_name = local.workers["cleanup"].worker_name
  schedules   = [for c in local.workers["cleanup"].cron : { cron = c }]

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

resource "cloudflare_workers_custom_domain" "svc" {
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
# 7) apps/web frontend SPA hosting — Cloudflare Pages Project
#
# Hosting choice: Pages Project over a 7th Worker for Vite React SPA because:
#   • Native static asset serving + gzip/brotli/edge CDN out of the box
#   • SPA hash routes need no fetch-routing glue (HashRouter lives client-side)
#   • Single production environment — no preview deploys (no `--branch` aliases)
#   • Default *.pages.dev subdomain assigned automatically — no custom domain
#     per project spec (zone_id-based workers_domain not required).
#   • build_config below is dashboard metadata only. Actual builds + deploys
#     are driven by GitHub Actions using:
#         wrangler pages deploy apps/web/dist --project-name ontodecide-prd-web
#
# Governance: Environment/Project/Service/Lifecycle are carried on the
# resource name and output block (cloudflare_pages_project does not
# support a native `tags` field).
# ============================================================================

resource "cloudflare_pages_project" "web" {
  account_id        = var.account_id
  name              = "${local.res_prefix}-web"
  production_branch = "main"

  # ------------------------------------------------------------------
  # Build config (Dashboard-metadata — informational only).
  # CI performs the real build: pnpm install && pnpm build for apps/web
  # and deploys via `wrangler pages deploy apps/web/dist`.
  # These values keep the Cloudflare UI "Retry deploy" aligned.
  # ------------------------------------------------------------------
  build_config = {
    build_command   = "pnpm install --frozen-lockfile && pnpm --filter @ontodecide/web build"
    destination_dir = "apps/web/dist"
    root_dir        = ""
  }

  # ------------------------------------------------------------------
  # Deployment configuration — single-environment system (production only).
  # Cloudflare API requires fail_open to be set equally for both
  # production and preview environments, so preview is mirrored here
  # even though no preview deploys are used.
  # ------------------------------------------------------------------
  deployment_configs = {
    production = {
      fail_open          = false
      compatibility_date = "2024-10-01"
    }
    preview = {
      fail_open          = false
      compatibility_date = "2024-10-01"
    }
  }
}

# ============================================================================
# --------- apps/web (service #7) — Worker fallback (NOT USED) ---------
# If a future iteration prefers a Worker-based edge-served SPA over Pages,
# enabling it requires these four edits — no structural refactor of the
# existing Worker tiers/for_each:
#
# (1) Add to local.workers:
#     web = { worker_name="${local.res_prefix}-web", service="web", has_db=false, cron=[], tier=1 }
# (2) If Gateway should forward to Web, append to local.gateway_service_bindings:
#     { binding="WEB_SERVICE", target="web" }
# (3) Append KV cache to local.kv_binding_map:
#     { svc="web", binding="CACHE" }
# (4) Append a web entry to DEFAULTS_MATRIX in deploy-service.yml
# ============================================================================
