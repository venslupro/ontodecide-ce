# ============================================================
# Durable Objects: planning agent.
#
# NOTE: this file intentionally contains NO Terraform resources.
#
# Durable Object NAMESPACES are NOT standalone Terraform resources in
# the Cloudflare provider v4.30.  Instead, Cloudflare creates the
# namespace automatically the FIRST TIME wrangler / Workers Builds
# deploys a Worker whose wrangler.toml contains:
#
#   [[durable_objects.bindings]]
#   name       = "AGENT"
#   class_name = "PlanningAgent"
#
#   [[migrations]]
#   tag         = "v1"
#   new_classes = ["PlanningAgent"]
#
# For the AI Worker, that declaration lives in:
#   apps/api/ai/wrangler.toml
#
# Terraform's ONLY role for this Durable Object is TWO references
# kept elsewhere in the module:
#
#   [1] workers.tf  → cloudflare_worker_script.ai_service.durable_object_binding
#       keeps Terraform's dependency graph correct so that a change
#       to the bound worker is reflected in outputs.
#   [2] outputs.tf  → (future) Durable Object namespace id, if the
#       provider exposes it later.
#
# The DO class_name itself is intentionally NOT re-declared as a
# Terraform output here: doing so duplicates the output already
# defined in outputs.tf, which causes `terraform validate` to fail
# with `Duplicate output definition`.
# ============================================================

# Reference: exported locally for documentation; do NOT duplicate as
# a `terraform output` in this file (output IDs must be unique per
# module). Add a single, authoritative output to outputs.tf if one
# should be surfaced to callers.
locals {
  planning_agent_class = "PlanningAgent"
}
