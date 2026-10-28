## 1. 平台归一化与迁移

- [x] 1.1 `internal/service/group.go`：`NormalizeGroupPlatform("")` 返回 `PlatformComposite`，更新注释（说明平台字段已降级为形态标记）
- [x] 1.2 `internal/service/group.go`：`profitControlPlatformSupported` 加入 `PlatformComposite`
- [x] 1.3 `internal/service/group.go`：`ValidateProfitControlConfig` 的错误文案改为"利润控制支持所有平台的分组"，去掉平台枚举
- [x] 1.4 `internal/service/group.go`：`IsGroupBindableInSimpleMode` 改为不排除任何分组
- [x] 1.5 新增迁移 `backend/migrations/249_universal_group_platform.sql`：`UPDATE groups SET platform='composite' WHERE platform<>'composite'`，`ALTER COLUMN platform SET DEFAULT 'composite'`，可重入
- [x] 1.6 `backend/ent/schema/group.go`：`platform` 字段默认值改为 `domain.PlatformComposite`，注释说明全平台语义；`go generate ./ent` 重新生成
- [x] 1.7 迁移测试 `migrations/universal_group_platform_migration_test.go`：回填所有非 composite 行、默认值生效、重复执行幂等

## 2. 管理端接口放宽

- [x] 2.1 `handler/admin/group_handler.go`：`CreateGroupRequest.Platform` 与 `UpdateGroupRequest.Platform` 去掉 `group_platform` 绑定校验（字段保留兼容）
- [x] 2.2 `service/admin_group.go` CreateGroup：忽略 `input.Platform`，`platform := PlatformComposite`
- [x] 2.3 `service/admin_group.go` UpdateGroup：忽略 `input.Platform`，强制 `group.Platform = PlatformComposite`
- [x] 2.4 `service/admin_group.go`：删除"简单模式禁止 composite"（`:427-428`、`:810-812`）与 `handler/admin/group_handler.go:651` 的同步校验
- [x] 2.5 `service/admin_group.go`：`normalizeGroupModelPricing` 对空白 `platform` 的填充值改为 `PlatformComposite`（保持 per-entry platform 可显式覆盖）
- [x] 2.6 `repository/group_repo.go`：`ListBindableWithFilters` 去掉 `platform <> 'composite'`
- [x] 2.7 `repository/group_repo.go`：`ListActiveByPlatform` 保留（供历史 `<platform>-default` 查找），新增 `ListActiveByExactName`
- [x] 2.8 `handler/admin/account_handler.go`：删除简单模式隐藏 composite 分组的逻辑（`:256-320`）
- [x] 2.9 `service/admin_account.go:501`：自动绑定默认分组改为"同名 `<platform>-default` 优先，否则 `default`"
- [x] 2.10 `handler/admin/platform_validation.go`：`group_platform` 校验器保留但仅供内部使用，注释说明分组平台恒为 composite

## 3. 解除单平台 sanitizer（防静默丢配置）

- [x] 3.1 `service/group_codex_models_manifest.go`：`normalizeCodexModelsManifestConfig` 接受 composite；成员校验保持"必须是分组内 openai 平台账号"
- [x] 3.2 `service/openai_messages_dispatch.go`：`sanitizeGroupMessagesDispatchFields` 对 composite 不再清空 `AllowMessagesDispatch` / `DefaultMappedModel` / `MessagesDispatchModelConfig`
- [x] 3.3 `service/admin_group.go` CreateGroup：`allowBatchImageGeneration` 平台条件由 `== gemini` 改为"允许 gemini 与 composite"
- [x] 3.4 `service/admin_group.go` UpdateGroup：同上（`:880`）
- [x] 3.5 `service/admin_group.go`：`DefaultAllowImageGenerationForPlatform(composite)` 返回 true
- [x] 3.6 `service/admin_group.go`：`validateFallbackGroupOnInvalidRequest` 允许 composite 作为当前/兜底分组；保留"订阅分组不得设置兜底""兜底分组不得自成兜底"约束
- [x] 3.7 `service/admin_group.go`：`canCopyAccountsFromGroupPlatform` 简化（源恒为 composite → 恒真）
- [x] 3.8 单元测试：全平台分组保存利润控制 / Codex manifest / Messages 映射 / 批量生图 / Live / Fast 后配置不丢失

## 4. 修复现存 composite 缺陷

- [x] 4.1 `service/gemini_messages_compat_service.go`：`resolvePlatformAndSchedulingMode` 优先读 `ResolvedTargetPlatformFromContext`，其次按 model 调 `DetectModelPlatform`，都无法解析时返回可判定错误（不可调度）
- [x] 4.2 `handler/composite_platform.go`：4 个 helper 的 `group.Platform != composite` 早退条件移除，改为无条件执行目标平台解析
- [x] 4.3 `service/account_stats_pricing.go`：渠道定价查询平台由 `channelService.GetGroupPlatform` 改为账号自身 `Platform`
- [x] 4.4 `service/billing_inflight_reservation.go:757`：`platform` 计算改为 ctx 解析平台 → 账号平台 → `openai`
- [x] 4.5 `service/gateway_usage_billing.go`：`QuotaPlatform` 在 composite 未解析时回退到账号平台；`PlatformFromAPIKey` 对 composite 返回空串的语义保留
- [x] 4.6 单元测试：Gemini messages 在全平台分组下按模型选中正确平台账号；账号统计定价命中渠道价；inflight 估费按 grok/gemini 解析；配额按解析平台累加

## 5. 简单模式合并默认分组

- [x] 5.1 `repository/simple_mode_default_groups.go`：改为确保存在单个名为 `default` 的 composite 分组；历史 `*-default` 分组保留不删
- [x] 5.2 删除 `backfillSimpleModeGrokDefaultImageGeneration` 中对平台枚举的依赖（或改为对全部分组生效）
- [x] 5.3 单元测试：简单模式启动后只有 `default` 一个默认分组被创建；已有历史分组不被删除；重复启动不重复创建
- [x] 5.4 简单模式下账号可绑定全平台分组（原拒绝路径的回归测试翻转）

## 6. 后端既有测试适配

- [x] 6.1 `internal/server/api_contract_test.go`：`/admin/settings` 契约期望值补齐本仓库新增的 4 个字段（`strict_priority_fallback`、`strict_priority_retry_count`、`strict_priority_cooldown_minutes`、`rewrite_parallel_tool_calls_to_false`）
- [x] 6.2 分组相关测试固件把 platform 从具体平台改为 composite，并补充"平台字段被忽略"的断言
- [x] 6.3 检查并修正对 `NormalizeGroupPlatform` / 简单模式默认分组的既有断言

## 7. 前端

- [x] 7.1 `types/index.ts`：`GroupPlatform` 收敛（保留类型别名，注释说明恒为 composite）
- [x] 7.2 `views/admin/GroupsView.vue`：删除创建表单平台选择器（`:513-523`）与编辑表单只读平台展示（`:2163-2174`）；提交不再发送 `platform`
- [x] 7.3 `views/admin/GroupsView.vue`：删除分组表格平台列与平台筛选（或改为"全平台"固定展示）
- [x] 7.4 `views/admin/GroupsView.vue`：解除所有 `v-if` 平台条件块 —— 图片/视频/语音定价、利润控制、MCP XML、supported_model_scopes、Claude Code 限制、模型路由、web search 价、Messages 映射、Fast、Live、账号筛选、无效请求兜底
- [x] 7.5 `views/admin/groupsProfitControl.ts`：`isProfitControlPlatform` 恒 true
- [x] 7.6 `views/admin/groupsImagePricing.ts`：`supportImagePricingPlatform`、`supportsVideoPricingPlatform` 恒 true；`defaultAllowImageGenerationForPlatform` 对 composite 返回 true
- [x] 7.7 `views/admin/groupsSupportedModelScopes.ts`：`normalizeSupportedModelScopesForPlatform` 不再对 composite 返回 `[]`
- [x] 7.8 `views/admin/GroupsView.vue`：`canCopyAccountsFromGroup`、`fallbackGroupOptions`、`invalidRequestFallbackOptions`、`resetDisabledBatchImagePricing` 解除平台过滤
- [x] 7.9 `views/user/KeysView.vue`：删除创建 Key 的"厂商"选择步骤，直接列出全部可选分组
- [x] 7.10 `views/admin/ChannelsView.vue`：分组在平台分栏中的复用保持（全平台分组出现在每个平台分栏）
- [x] 7.11 `components/admin/orders/PlanEditDialog.vue`、`views/admin/SubscriptionsView.vue`：平台标签/筛选改为"全平台"固定文案，不再展示过期的 platform 值
- [x] 7.12 中英文 i18n：新增"全平台分组"文案，删除 `platformHint` / `platformNotEditable`，`groups.platforms.*` 收敛为 `composite`
- [x] 7.13 前端测试：GroupsView 平台区块在无平台选择时仍渲染；`supported_model_scopes` 不再被清空；locale key 完整性

## 8. 文档

- [x] 8.1 `docs/COMPOSITE_GROUPS.md` 改写并重命名为 `docs/UNIVERSAL_GROUPS.md`（分组默认全平台），保留路由表章节
- [x] 8.2 说明 fail-closed 模型识别与推荐写法（provider 前缀 / 显式路由）

## 9. 验证

- [x] 9.1 后端 `go build ./...`（golang:1.27.3 容器，8 GiB / 3 CPU）
- [x] 9.2 后端 `go test -tags=unit ./internal/... ./ent/... ./pkg/...`，与改造前红灯基线对比，不得新增失败
- [x] 9.3 前端 `pnpm@9 install --frozen-lockfile`、`vue-tsc --noEmit`、`vitest run`、`vite build`
- [x] 9.4 端到端核对：容器+HTTP 双健康、迁移 249 已应用、3 个分组全部 composite、真实流量按解析平台调度到 openai 账号（gemini/grok/anthropic 侧缺真实账号，未覆盖）：同一分组下 Anthropic / OpenAI / Gemini / Grok 各一次请求落在正确账号；订阅分配后可用；配额按解析平台累加
