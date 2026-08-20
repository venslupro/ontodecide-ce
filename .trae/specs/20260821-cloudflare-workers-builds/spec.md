# Cloudflare Workers Builds / Pages Git 部署方式合规性整改 - PRD

## Overview
- **Summary**: 对照 Cloudflare 官方推荐的 Workers Builds（Git 直连）与 Terraform 资源创建最佳实践，审查并修复当前仓库的资源命名、Worker 绑定、构建路径、IaC 所有权边界、CI 与运行脚本的不一致，直到本地构建、Terraform Plan 与 Cloudflare 推荐路径（Build command + Deploy command + Root Directory）均可成功。
- **Purpose**: 避免在首次 `git push` 到 Cloudflare Builds 时出现构建失败、绑定缺失、资源名不匹配、Terraform 与 Workers Builds 反复互相覆盖（drift）等问题，确保 "IaC 建基础设施，Workers Builds 建代码版本" 的推荐分工被严格执行。
- **Target Users**: 仓库维护者（执行首次部署）、CI 触发者（PR 合并者）、On-Call（故障排查者）。

## Goals
- G1: 6 个 Worker（gateway/user/graph/ingestion/ai/cleanup）的 wrangler.toml 均符合 Cloudflare Workers Builds 官方 Build settings 模型（Build command / Deploy command / Root directory），构建步骤可在 Cloudflare 构建镜像中复现。
- G2: Terraform 与 wrangler.toml 中的资源名（D1 名称、Queue 名称、Worker 脚本名、KV 绑定）一一对应，REPLACE_WITH 占位与 terraform output 的键名严格一致，环境后缀策略统一。
- G3: 明确 Terraform 对 `cloudflare_worker_script` 仅拥有 **绑定清单（bindings）所有权**，脚本内容/上传由 Workers Builds 独占——消除两者对同一脚本内容的竞态。
- G4: 根 wrangler.toml、`[build]` 段与 `.cloudflare/workers-builds.yaml` 去伪存真：删除 Custom Builds 相关无效项，保留 Cloudflare Builds 实际读取的字段；提供一份可直接粘贴到控制台的每个 Worker Build settings 对照表（作为文档注释）。
- G5: 本地自验证通过：`pnpm -r typecheck`、`pnpm -r build`、`pnpm test`、`terraform -chdir=infrastructure/terraform init -backend=false && terraform validate` 全部成功。
- G6: CI（ci.yml + terraform-deploy.yml）与脚本（deploy.sh、migrate.sh）引用的 D1 / Queue / bucket 名称与 Terraform 输出一致，不出现 "找不着 queue/db" 错误。

## Non-Goals
- NG1: 不在本次整改中创建真实的 Cloudflare 账户、B2 Bucket 或 Neo4j Aura（缺少 Secrets 的 Terraform Plan 仍允许优雅跳过）。
- NG2: 不把已有 wrangler.toml 迁移为 wrangler.jsonc（允许后续独立 PR）。
- NG3: 不启用真实的 Cloudflare Pages 资源（前端不存在），仅维持 pages.tf 中占位注释 + Builds 说明一致。
- NG4: 不引入 `cf-branch-wrangler` 等第三方分支资源方案（当前分支部署暂不在范围）。
- NG5: 不实现多环境 `[env.staging]` / `[env.production]` 段（当前仅保留变量层的 `var.environment` 后缀策略）。

## Background & Context
- 当前项目：pNPM workspaces + Turbo monorepo，6 个 Hono Worker，共享包 `@ontodecide/shared`，构建产物 `dist/index.js`。
- 当前状态：Terraform 中 D1/Queue 名称被命名为 `${project}-${resource}-${environment}`（含环境后缀），但 wrangler.toml 中 `[[d1_databases]].database_name`、`[[queues_*]].queue` 与 `migrate.sh` 使用无后缀短名（如 `decision-db`、`ingestion-queue`），两者**不匹配**。
- 根 `wrangler.toml` 声明了 `[build] command = "pnpm install ... && turbo build"`，但 Cloudflare 官方文档（Workers Builds Configuration）明确说明：**Workers Builds 不遵循 wrangler.toml 中的 Custom Builds 设置**，构建行为完全由 Dashboard Build settings（Build command + Root directory + Deploy command）决定。
- Terraform 的 `cloudflare_worker_script` 在官方最佳实践中用于：① Worker 绑定声明（KV/D1/Queue/AI/DO）② 与 `cloudflare_worker_cron_trigger` 等下游资源建立依赖；内容/上传应交给 Workers Builds（或 CI 中的 wrangler deploy）。目前缺少 `lifecycle { ignore_changes = [content, module] }` 以避免 Terraform 在 apply 时与 Workers Builds 上传的内容发生漂移。
- `.cloudflare/workers-builds.yaml` 不是 Cloudflare Builds 官方读取的文件（Build settings 存在于 Dashboard），但其用途应当是 "给人/脚本看的 dashboard 配置对照单"，内容必须与官方字段对齐。当前文件把 `[build.upload]` 语义合并到 `build_output` / `main`，缺少 Deploy command / Root directory / Non-production deploy command。

## Functional Requirements
- **FR-1（Workers Builds Build settings 一致性）**: 6 个 Worker 分别提供 Build command（从仓库根执行、显式 `corepack enable && pnpm install --frozen-lockfile && pnpm turbo run build --filter=<pkg>`）、Root directory（`""`，因为需要 workspace + turbo）、Deploy command（`npx wrangler deploy`）、Non-production branch deploy command（`npx wrangler versions upload`）。对照表写入 `.cloudflare/workers-builds.yaml`，每条字段名与 Cloudflare 文档一致。
- **FR-2（资源命名对齐 Terraform）**:
  - 所有 `wrangler.toml` 的 `[[d1_databases]].database_name` 改为 `${project_name}-decision-db-${environment}` 默认值（带环境后缀），与 `cloudflare_d1_database.decision_db.name` 一致；`migrate.sh` 中 DB_NAME 使用带后缀形式或接受 ENV 参数覆盖。
  - 所有 `[[queues_producers]]` / `[[queues_consumers]]` 的 `queue` 与 `dead_letter_queue` 改为带环境后缀的默认值，与 `cloudflare_queue.*.name` 一致（`${project}-ingestion-${env}`、`${project}-ingestion-dlq-${env}`、cleanup 同）。
  - 保留 "若 dashboard Variables 覆盖，则 wrangler.toml 默认值失效" 的说明；默认值保持与 Terraform `var.environment=production` 的结果相同，以便零配置直连。
- **FR-3（Workers Builds 不读 Custom Builds）**: 删除根 `wrangler.toml` 中 `[build]` 段（会误导维护者）。每个 Worker wrangler.toml 保留 `[build]` / `[build.upload]` 但在注释中标明：**本 [build] 仅服务于本地 `wrangler dev` / `wrangler deploy`，Workers Builds 以 Dashboard Build settings 为准**。Build command 中的 `cwd=` 必须与 monorepo 实际布局（apps/api/<name>）保持一致。
- **FR-4（Terraform 绑定 vs 内容解耦）**: `cloudflare_worker_script.*` 6 个资源全部补充 `lifecycle { ignore_changes = [content, module] }` 以及必要的 precondition/postcondition，保证只管理 bindings。删除 `durable-objects.tf` 中多余的 `output "planning_agent_class"` 重复声明（已存在 `outputs.tf`），否则 Terraform 会报错重名。
- **FR-5（B2 bucket 默认值对齐）**: ingestion/cleanup wrangler.toml 中 `B2_REGION` / `B2_INGESTION_BUCKET` / `B2_ARCHIVE_BUCKET` 的 [vars] 默认值改成模板化说明（使用变量名并在注释中引用 terraform output 键）；与 B2 资源 `${project}-ingestion-staging-${env}` / `${project}-tenant-archive-${env}` 命名一致。
- **FR-6（占位→输出键）**: 每个 `REPLACE_WITH_KV_ID`、`REPLACE_WITH_D1_ID` 注释必须引用 `terraform output` 的键名（如 `kv_namespaces["jwt-blacklist"]`、`d1_database_id`），避免运维复制错字段。
- **FR-7（CI/脚本修正）**: `scripts/migrate.sh` 接受 `--env ENV`（默认 production）并构造带后缀 DB 名称；`scripts/deploy.sh` 更名为 `scripts/build-worker.sh` 并以注释形式保证其命令行与 Workers Builds Build command 1:1 对应（可被 Builds 作为 Build command 直接调用）。`.github/workflows/ci.yml` 确保 pnpm 来自 corepack（与 Workers Builds 环境镜像行为一致），`terraform-deploy.yml` 在 Apply 之后增加一个 "输出映射表" step（把 D1/KV/Queue/Worker/Bucket 输出汇总为 Markdown 对照表作为 summary，便于将值填入 Dashboard Variables）。
- **FR-8（Pages 占位合规）**: `pages.tf` 保持注释，但新增与 Workers Builds 对齐的注释说明：**前端存在时使用 `cloudflare_pages_project` + Git 连接（推荐路径），而不是将 Pages 作为 Terraform content 管理**。

## Non-Functional Requirements
- **NFR-1（可构建性）**: 在没有 Cloudflare/B2 凭证的环境下本地执行 `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r build && pnpm test` 全部 exit 0。
- **NFR-2（Terraform 配置有效性）**: `terraform init -backend=false` + `terraform validate` 通过，无 `Duplicate output`、`Invalid lifecycle block`、`Unrecognized argument` 等错误。
- **NFR-3（Workers Builds 可复现）**: 任何维护者按 `.cloudflare/workers-builds.yaml` 提供的 4 元组（Root directory / Build command / Deploy command / Non-production deploy command）粘贴到 Dashboard，Worker 即可完成首次 deploy 而无需更改代码。
- **NFR-4（无漂移）**: 对同一账户按顺序执行 `terraform apply` → `git push 触发 Workers Builds` → 再 `terraform plan`，`plan` 不得报告 6 个 worker_script 的 content/module 变化（即无 drift）。
- **NFR-5（可读与注释充分）**: 每个 wrangler.toml 的 Ownership split 注释均声明 "Terraform 管资源，Workers Builds 管代码版本"，并指向 `terraform output` 的具体键。

## Constraints
- **技术 C1**: Cloudflare Builds 使用的 pnpm 通过 corepack 安装（packageManager=pnpm@9.12.0 必须保留），不能同时在动作中指定版本。
- **技术 C2**: Workers Builds 不读 wrangler.toml 的 Custom Builds（官方文档明确）。
- **技术 C3**: Terraform state 后端使用 B2 S3 兼容模式；本整改不得改动 backend 语义。
- **技术 C4**: Worker 脚本名（gateway/user/graph/ingestion/ai/cleanup 前缀 `${project}-<...>`）不能变更，否则 Cron Trigger、service URLs、已有 Secrets 绑定会同时失效。
- **技术 C5**: D1 migrations 通过 `wrangler d1 migrations apply <database_name>` 执行，数据库名必须与 D1 资源 `name` 完全一致。

## Dependencies
- Cloudflare Provider `~> 4.30`（既定）。
- Wrangler `^3.83.0`（既定）；Workers Builds 使用 package.json 中的 wrangler 版本。
- pnpm workspace + turbo build pipeline（既定）。

## Assumptions
- A1: 首次部署时，运维会先运行 Terraform 创建 D1/KV/Queue/Bucket，再将 `terraform output` 中的 ID 填入各 Worker wrangler.toml 的 REPLACE_WITH 占位 **或** 直接在 Dashboard Variables & Secrets 中设置（Cloudflare 推荐后者）。
- A2: `var.environment == "production"` 是默认场景；staging 通过 `tfvars` 或 env var 覆盖。
- A3: Workers Builds 的 API token 在 Dashboard 连接仓库时创建；CLOUDFLARE_API_TOKEN 仅用于 Terraform 与 CI fallback wrangler deploy。

## Open Questions
- [ ] 是否需要在此整改**同时**加入 `[env.staging]` / `[env.production]` 多段 wrangler 配置？（默认否：NG5）
- [ ] 是否需要在 terraform-deploy.yml 增加 `wrangler deploy` fallback job 作为 Workers Builds 未连接前的部署通道？（默认否：当前 scope 仅合规与命名）

## Acceptance Criteria

### AC-1: Workers Builds Build settings 对照表存在且字段匹配 Cloudflare 官方
- **Type**: `rule`
- **Given**: 仓库内存在 `.cloudflare/workers-builds.yaml`
- **When**: 打开文件并核对 Cloudflare Workers Builds Configuration 文档定义的四个关键字段（Build command、Deploy command、Non-production branch deploy command、Root directory）
- **Then**: 对 6 个 Worker 分别提供准确的字段值；Build command 含 corepack + frozen-lockfile install + turbo build --filter；Deploy command 为 `npx wrangler deploy`；非生产命令为 `npx wrangler versions upload`；Root directory 为仓库根（空串或 `.`）
- **Pass Condition**: 文件无语法错误、每个 Worker 条目都包含 4 字段且命令可复制执行
- **Evidence**: 读取 `.cloudflare/workers-builds.yaml` 并断言键存在；同时本地 `grep` 校验 6 条命令片段

### AC-2: D1/Queue 名称在 wrangler.toml、Terraform、migrate.sh 中完全一致
- **Type**: `rule`
- **Given**: 完成代码整改且未提供任何真实 ID
- **When**: 对比 `cloudflare_d1_database.decision_db.name`、所有 `[[d1_databases]].database_name`、`migrate.sh` DB_NAME 与 `cloudflare_queue.*.name`、所有 `[[queues_*]].queue` / `dead_letter_queue`
- **Then**: 默认情况（env=production, project=ontodecide）下名称完全一致，且包含 `${var.project_name}-*-${var.environment}` 后缀模式
- **Pass Condition**: 正则比对均相等，migrate.sh 默认 DB 名与 Terraform 资源名一致
- **Evidence**: `grep -R` 扫描 `*.toml`, `*.tf`, `scripts/*.sh` 的 queue/database_name 并输出列表；手动列表对齐

### AC-3: Terraform validate 通过且无重复 output
- **Type**: `rule`
- **Given**: 在 `infrastructure/terraform` 目录
- **When**: `terraform init -backend=false` 后执行 `terraform validate`
- **Then**: 输出 `Success! The configuration is valid.`，且没有 Duplicate output 或 lifecycle 语法错误
- **Pass Condition**: exit 0 且无错误日志
- **Evidence**: 命令实际执行输出的完整日志

### AC-4: 所有 cloudflare_worker_script 声明内容非所有权（ignore_changes）
- **Type**: `rule`
- **Given**: 完成整改后
- **When**: 扫描 workers.tf 中 6 个 `resource "cloudflare_worker_script"` 定义
- **Then**: 每个都包含 `lifecycle { ignore_changes = [content, module] }`（或在 provider v4 schema 下的等效忽略字段名）；没有声明 `content = file(...)` 等内容上载
- **Pass Condition**: 6/6 个资源都包含 ignore_changes 且无 content = file 子句
- **Evidence**: Grep 统计 `ignore_changes = \[content, module\]` 出现次数等于 6；反向 grep `content = file(` 结果为 0

### AC-5: 本地构建流水线全部成功
- **Type**: `rule`
- **Given**: 空 `node_modules`（若存在即先执行安装）
- **When**: 执行 `pnpm install --frozen-lockfile && pnpm -r typecheck && pnpm -r build && pnpm test`
- **Then**: 四条命令全部 exit 0，且所有 Worker 的 `dist/index.js` 均产出
- **Pass Condition**: 退出码 0、dist 存在
- **Evidence**: 四步命令的退出码和关键日志；`find apps/api/*/dist/index.js` 列表

### AC-6: Terraform deploy workflow 在 Apply 后输出 Markdown 绑定对照表
- **Type**: `rule`
- **Given**: 打开 `.github/workflows/terraform-deploy.yml`
- **When**: 检查 Apply job 的最后 step
- **Then**: 存在一个 `Write binding mapping to GITHUB_STEP_SUMMARY` 步骤，将 D1 id、KV map、Queue map、Worker names、B2 buckets 以 Markdown 表格输出
- **Pass Condition**: step 存在且使用 outputs.tf 中同名键
- **Evidence**: 文件 grep + yq 断言（或结构化 grep 6 项）

### AC-7: 根 wrangler.toml 不声明 Custom Builds（避免误导）
- **Type**: `rule`
- **Given**: 打开根 `wrangler.toml`
- **When**: 统计 `[build]` 段是否存在
- **Then**: 没有 `[build]` / `command =` 段；文件仅保留 `name`、`compatibility_date`、`compatibility_flags`，并在注释中说明 "Workers Builds 不读 Custom Builds"
- **Pass Condition**: `grep -c '^\[build\]' wrangler.toml` 为 0
- **Evidence**: grep 输出

### AC-8: 部署与迁移脚本、Build command 三者 1:1 对齐
- **Type**: `rule`
- **Given**: 脚本 `scripts/build-worker.sh`（原 deploy.sh 更名）与 `.cloudflare/workers-builds.yaml` 以及各 Worker wrangler.toml 的 `[build].command`
- **When**: 对同一 Worker 包名对比脚本中的 turbo 命令与 yaml/Build command
- **Then**: 脚本命令行与 Build command 逻辑等价（corepack enable + frozen-lockfile install + turbo build --filter）
- **Pass Condition**: 6 个 Worker 的 `--filter` 都出现在脚本与 yaml/Build command 注释对中
- **Evidence**: grep `turbo run build --filter=` 三个位置的数量一致

### AC-9: 配置可读性（Ownership split 注释完整度）
- **Type**: `rubric`
- **Dimension**: 维护者在 10 分钟内理解 "哪些东西归 Terraform，哪些归 Workers Builds / Dashboard" 的信息完整度
- **Scale**: 1-5
- **Anchors**: 1 = 完全缺失说明；3 = 部分 worker 有注释但占位与 output 键不对应、或未说明 Builds 不读 Custom Builds；5 = 6 个 wrangler.toml + 根 toml + workers-builds.yaml + Terraform 头部注释四者覆盖一致、REPLACE_WITH 指引唯一对应 output 键、Dashboard 操作步骤明确
- **Pass Threshold**: >= 4
- **Evidence**: 逐文件审阅注释并给分，附理由

### AC-10: 资源与绑定漂移防护有效性（运行级鲁棒性）
- **Type**: `rubric`
- **Dimension**: 同一账户上交替执行 IaC 与 Builds 时产生的可观测 drift 风险
- **Scale**: 1-5
- **Anchors**: 1 = worker_script 内容会被 Terraform 覆盖或完全缺失 bindings 同步机制；3 = ignore_changes 生效但 Queue/D1 名不匹配导致运行时报错；5 = ignore_changes + 名称完全对齐 + cron 仅由 Terraform 声明（或与 wrangler 同步注释），运维无踩坑
- **Pass Threshold**: >= 4
- **Evidence**: 审阅 6 个 worker 的三类证据：(a) lifecycle (b) 绑定名与资源 (c) cron 声明方式，并附理由打分
