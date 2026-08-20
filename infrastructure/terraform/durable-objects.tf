# ============================================================
# Durable Objects: planning agent.
#
# Durable Object classes are declared by the AI Worker's wrangler.toml
# (`[[durable_objects.bindings]]` and `[[migrations]]`); the namespace is
# created automatically on first deploy. This file exists so the IaC
# record shows the dependency; there is no standalone Terraform resource
# for Durable Object namespaces as of provider v4.30.
# ============================================================

locals {
  planning_agent_class = "PlanningAgent"
}

# Note: a real implementation would import the worker via the
# cloudflare_worker_script data source and reference its DO binding; for
# the prototype we only record the class name for documentation.
output "planning_agent_class" {
  value = local.planning_agent_class
}
