# Cloudflare Workers Builds / Pages Git 合规整改 - Implementation Plan

## Task 1: 修复 Terraform（绑定所有权、重复 output、命名）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 为 6 个 `cloudflare_worker_script.*` 资源追加 `lifecycle { ignore_changes = [content, module] }`，确保 IaC 只管理 bindings 不与 Workers Builds 上传内容发生漂移。
  - 删除 `infrastructure/terraform/durable-objects.tf` 中与 outputs.tf 重名的 `output "planning_agent_class"`，修复 Terraform validate 必然失败的 Duplicate output 问题。
  - 在 `workers.tf` 头部添加 "Terraform vs Workers Builds 所有权边界" 注释，与 wrangler.toml 注释保持同一句话。
  - 校验所有 `cloudflare_*` 资源的引用：`d1_database_binding.database_id`、`kv_namespace_binding.namespace_id`、`queue_binding.queue_name` 均使用正确的 Terraform 引用表达式（已完成则不改动，保证 plan 不报错）。
- **Acceptance Criteria Addressed**: AC-2, AC-3, AC-4, AC-10
- **Test Requirements**:
  - `rule` TR-1.1: 运行 `cd infrastructure/terraform && terraform init -backend=false && terraform validate` 输出 `Success! The configuration is valid.`（exit 0）。Evidence: 命令 stdout 尾部 + exit code。
  - `rule` TR-1.2: `grep -c 'ignore_changes = \[content, module\]' infrastructure/terraform/workers.tf` 输出 >= 6。Evidence: grep 输出。
  - `rule` TR-1.3: `grep -c 'content = file(' infrastructure/terraform/*.tf` 输出 0。Evidence: grep 输出。
  - `rule` TR-1.4: `grep -c '^output "planning_agent_class"' infrastructure/terraform/*.tf` 输出 1。Evidence: grep 输出。
  - `rubric` TR-1.5: 维度=IaC 与 Builds 边界注释一致性；Scale 1-5；Anchors 1=无说明/3=部分说明/5=workers.tf 头部与每个资源的内联注释均声明所有权；Threshold>=4；Evidence: 审阅 3 处关键文件（workers.tf、pages.tf、main.tf）。
- **Notes**: provider schema 中 `cloudflare_worker_script` 的字段在 v4.30 中 `content`/`module` 均为可选；若 lint 对 `module = true` 与 `ignore_changes = [module]` 同时出现给出警告，允许改为只 `ignore_changes = [content]`，但需在注释中记录原因（"module 为声明式常量不会因 Workers Builds 改变"）。

## Task 2: 重写 `.cloudflare/workers-builds.yaml`（Cloudflare Build settings 映射表）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 依据 Cloudflare Workers Builds Configuration 官方文档的四个字段（Build command、Deploy command、Non-production branch deploy command、Root directory），为 6 个 Worker 各写一份条目。
  - Build command 必须包含：`corepack enable` → `corepack prepare pnpm@9.12.0 --activate` → `pnpm install --frozen-lockfile --prefer-offline` → `pnpm turbo run build --filter=@ontodecide/<pkg>`。
  - Deploy command 固定 `npx wrangler deploy`；Non-production branch deploy command 固定 `npx wrangler versions upload`。
  - Root directory 固定 `.`（仓库根），因为 Turbo + workspace 需要在根执行 install/build，不能在 `apps/api/<name>` 内独立安装。
  - 每条条目同时列出 Environment variables 与 Secrets 的期望列表（参考既有变量名），与 wrangler.toml `[vars]` 名完全一致。
  - 在文件顶部补充 "此文件是给人看的 Dashboard Build settings 对照表 — Cloudflare Builds 不会自动读取本文件"。
- **Acceptance Criteria Addressed**: AC-1, AC-8, AC-9
- **Test Requirements**:
  - `rule` TR-2.1: `yq '.workers | length' .cloudflare/workers-builds.yaml`（或 grep `-c '^  - name:'`）== 6。
  - `rule` TR-2.2: 每个 worker 条目包含 4 字段：`build_command`, `deploy_command`, `preview_deploy_command`, `root_directory`；以及 `environment_variables` 和 `secrets` 数组。
  - `rule` TR-2.3: 6 条 build_command 都出现 `corepack enable`、`pnpm install --frozen-lockfile`、`pnpm turbo run build --filter=@ontodecide/` 子串。
  - `rule` TR-2.4: `deploy_command` 都是 `npx wrangler deploy`；`preview_deploy_command` 都是 `npx wrangler versions upload`。

## Task 3: 修正根 wrangler.toml（删除 Custom Builds 误导项）与所有 Worker wrangler.toml（命名+注释+默认值）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 根 `wrangler.toml`：去掉 `[build]` 段，保留 name/compatibility_date/compatibility_flags，并新增注释行说明 "Workers Builds 不读 Custom Builds；构建命令见 .cloudflare/workers-builds.yaml 与 Dashboard Build settings"。
  - 每个 Worker 的 wrangler.toml：
    - 保持 `[build] command/cwd` + `[build.upload]`（用于本地 `wrangler dev/deploy`），但在注释中标明 "本 [build] 仅服务于本地/CI fallback；Workers Builds 以 Dashboard Build settings 为准"。
    - `[[d1_databases]]`: `database_name` 从 `decision-db` 改为 `ontodecide-decision-db-production`（与 Terraform 默认值对齐）；并在注释中写 "如 var.environment != production 请在 dashboard Variables 覆盖或通过 --env 使用多环境段"。
    - `[[queues_producers]]` / `[[queues_consumers]]`: queue 与 dead_letter_queue 从 `ingestion-queue` / `cleanup-queue` 等改为 `${project}-<name>-${env}` 默认值（`ontodecide-ingestion-production` / `ontodecide-ingestion-dlq-production` / cleanup 同）。
    - `[vars]` 中 `B2_REGION` / `B2_INGESTION_BUCKET` / `B2_ARCHIVE_BUCKET`：保留默认值但在注释中引用 terraform output 键名（`b2_region` / `b2_buckets.ingestion_staging` / `b2_buckets.tenant_archive`），默认值与 Terraform `${project}-<name>-production` 一致。
    - REPLACE_WITH 注释：每个 `id = "REPLACE_WITH_KV_ID"` / `"REPLACE_WITH_D1_ID"` 注释准确引用 outputs.tf 中的键（`kv_namespaces["<key>"]`、`d1_database_id`）。
    - `[vars]` 中 `<ACCOUNT-SUBDOMAIN>`、`<REPLACE_WITH_AURADB_HOST>` 保持占位但在注释中引用 `TF_VAR_cloudflare_account_id_or_workers_dev` / `TF_VAR_neo4j_url` 的来源。
- **Acceptance Criteria Addressed**: AC-2, AC-7, AC-9, AC-10
- **Test Requirements**:
  - `rule` TR-3.1: `grep -c '^\[build\]' wrangler.toml`（仓库根）== 0。
  - `rule` TR-3.2: `grep 'database_name = ' apps/api/*/wrangler.toml` 全部命中 `ontodecide-decision-db-production`。
  - `rule` TR-3.3: `grep -E 'queue ?=|dead_letter_queue ?=' apps/api/{ingestion,cleanup}/wrangler.toml` 全部命中 `ontodecide-(ingestion|cleanup)(-dlq)?-production`。
  - `rubric` TR-3.4: 维度=注释一致性（Ownership split + REPLACE_WITH 指引）；Scale 1-5；Anchors 1=混乱/3=部分匹配/5=6 份 wrangler.toml 注释结构一致，占位唯一对应 terraform output；Threshold>=4。

## Task 4: 修正脚本（migrate.sh、build-worker.sh 即原 deploy.sh）并与 Build command 对齐
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - `scripts/migrate.sh`:
    - 增加 `--env ENV` 参数（默认 `production`）；允许通过 `PROJECT_NAME` 环境变量覆盖项目前缀（默认 `ontodecide`）。
    - DB_NAME 构造为 `${PROJECT_NAME:-ontodecide}-decision-db-${ENV}`，与 Terraform D1 资源 `name` 完全一致。
    - 将脚本引用的 worker 路径（`pnpm --filter=... exec wrangler d1 migrations apply`）保持不变。
  - 原 `scripts/deploy.sh` 更名为 `scripts/build-worker.sh`（因为它其实是 build 而非 deploy；deploy 由 Workers Builds 处理），并在注释中：
    - 声明 "可以直接作为 Workers Builds Build command 使用"。
    - 命令链与 Task 2 的 Build command 1:1 等价：corepack enable/prepare → frozen-lockfile install → turbo build --filter。
  - 在文件头写入 shebang、`set -euo pipefail`、参数缺失报错、`--help` 用法输出（如已存在则保持）。
- **Acceptance Criteria Addressed**: AC-2, AC-8
- **Test Requirements**:
  - `rule` TR-4.1: `bash -n scripts/migrate.sh scripts/build-worker.sh` exit 0。
  - `rule` TR-4.2: `./scripts/migrate.sh --help` 退出码 0 且输出 usage 字符串。
  - `rule` TR-4.3: 变量 trace 断言：在 `set -x; ENV=staging PROJECT_NAME=demo` 运行 migrate.sh 的 dry-run echo（建议新增 `--dry-run` 或通过 `set -n` + 环境替换模拟）后 DB_NAME == `demo-decision-db-staging`。
  - `rule` TR-4.4: `grep -E 'corepack enable|pnpm install --frozen-lockfile|turbo run build --filter=' scripts/build-worker.sh | wc -l` >= 3。

## Task 5: 强化 terraform-deploy.yml Apply 输出绑定对照表 + CI pnpm/corepack 对齐
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - `terraform-deploy.yml` Apply job：在 `terraform apply` 之后新增一个 step `Write binding mapping to GITHUB_STEP_SUMMARY`，执行 `terraform output -json` 并用 jq 将：
    - `d1_database_id`
    - `kv_namespaces`（遍历 key/ID 对）
    - `queues`
    - `worker_names`
    - `b2_buckets`
    - `b2_region`
    - `account_id`
    渲染为 Markdown 表格写入 `$GITHUB_STEP_SUMMARY`，列名分别为 `Binding Type`、`Binding Name / Key`、`Value (ID / Name)`、`Wrangler 绑定名 / Terraform output 键`。
  - `ci.yml`（Build·Lint·Test）：Setup pnpm 步骤增加 `run: corepack enable && corepack prepare pnpm@9.12.0 --activate`（与 Workers Builds 镜像、build-worker.sh、workers-builds.yaml 三者一致），消除 "Builds 环境使用 corepack、CI 环境却不一定激活" 的漂移。
- **Acceptance Criteria Addressed**: AC-6, AC-8, AC-9
- **Test Requirements**:
  - `rule` TR-5.1: `grep -c 'Write binding mapping to GITHUB_STEP_SUMMARY' .github/workflows/terraform-deploy.yml` == 1。
  - `rule` TR-5.2: Apply step 中 `terraform output -json` + `jq` 至少包含 d1/KV/queues/workers/b2 五类输出。
  - `rule` TR-5.3: `ci.yml` 中存在 `corepack enable`（或 pnpm/action-setup 的等效 post step 保证 corepack 激活）。

## Task 6: Pages 占位合规 + 全局 README / 文件头注释一致性
- **Status**: `pending`
- **Priority**: low
- **Depends On**: None
- **Description**:
  - `infrastructure/terraform/pages.tf`: 在注释中补充 Cloudflare 推荐模式："前端存在后，推荐使用 Cloudflare Pages Git 直连（Builds）部署，不使用 Terraform `source`/`direct_upload` 上传内容；本资源仅用于绑定（custom_domain、environment_variables）"。
  - 不在本任务中激活实际 Pages 资源（NG3）。
- **Acceptance Criteria Addressed**: FR-8（功能需求 8）
- **Test Requirements**:
  - `rule` TR-6.1: `grep -c 'Pages Git' infrastructure/terraform/pages.tf` >= 1（存在推荐路径说明）。
  - `rule` TR-6.2: pages.tf 内实际 resource 行依然保持注释（未启用）。

## Task 7: 端到端本地自验证（Install → Typecheck → Build → Test → Terraform validate）
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1, Task 3, Task 4
- **Description**:
  - 真实执行以下命令并记录输出（作为 Completion Evidence）：
    1. `pnpm install --frozen-lockfile`
    2. `pnpm -r typecheck`
    3. `pnpm -r build`
    4. `pnpm test`
    5. `find apps/api/*/dist/index.js`
    6. `cd infrastructure/terraform && terraform init -backend=false && terraform validate`
  - 若任何一步失败，回到相应任务修复。不得为了通过而跳过失败项。
- **Acceptance Criteria Addressed**: AC-3, AC-5
- **Test Requirements**:
  - `rule` TR-7.1: 上述 6 步 exit code 全部为 0。
  - `rule` TR-7.2: `find` 输出至少包含 6 条 `apps/api/<name>/dist/index.js`。
  - `rule` TR-7.3: terraform validate 输出文本 `Success! The configuration is valid.`。
