## Context

### 现状：能力已内建，但被"单平台"假设包住

- `groups.platform`（`ent/schema/group.go:84`）单列，`MaxLen(50) DEFAULT 'anthropic'`，无 DB CHECK 约束（`migrations/242_drop_platform_check_constraints.sql` 已移除）。
- 平台清单 `internal/domain/platforms.go` 是唯一来源；`IsGroupPlatform` 接受具体平台或 `composite`。
- `composite` 分组已实现完整的跨平台运行时：
  - 平台解析：`DetectModelPlatform`（`service/composite_platform.go:83`）+ 显式路由表 `composite_model_routes` + 账号模型归属推断，歧义 fail-closed（`routes/gateway.go:588`）。
  - 调度：`gateway_scheduling.go:51` 在 composite 下把 `platform` 替换为解析结果，`isAccountAllowedForPlatform`（`:1233`）按**解析后**平台过滤账号。
  - 调度器快照：`scheduler_snapshot_service.go:829` 已按 `domain.CompositePrecedencePlatformIDs()` 枚举全部平台桶（`SchedulerBucket{GroupID, Platform, Mode}`）。
  - 计费/计量/查价：`channel_service.go:356-384`、`gateway_usage_billing.go:942`、`usage_log_repo.go:37`（`CASE WHEN g.platform='composite' THEN a.platform`）。
  - 订阅：`subscription_plans.group_id` / `user_subscriptions.group_id` 与平台无关，composite 分组今天就能售卖与分配。
- 账号↔分组是 `account_groups` 多对多表（`ent/schema/account_group.go`），**无平台一致性约束**，混平台绑定今天就能落库。

### 阻碍

1. 创建分组必须选平台（`group_handler.go:191,267` 的 `group_platform` 绑定校验；前端 `GroupsView.vue:513`）。
2. 一批 sanitizer 把 composite 当"不支持"，保存时**静默清零**既有配置（见 D3）。
3. 前端 20+ 处 `v-if platform===xxx` 配置区在 composite 下消失，且 `normalizeSupportedModelScopesForPlatform` 会提交 `[]` 覆盖清空。
4. 简单模式把 composite 当非法形态（默认分组按平台种子化、绑定下拉排除、payload 隐藏）。
5. 现存 composite 缺陷在"全部流量都走 composite"后会被放大到全站（见 D4）。

## Goals / Non-Goals

**Goals:**
- 一个分组绑定任意平台账号；一张订阅访问全部平台；分组不再需要平台概念。
- 所有原本按平台隔离的分组配置在全平台分组上可用，且**不再静默丢配置**。
- 调度安全：任何请求仍然只在"模型解析出的目标平台"账号池中选账号。
- 迁移可回滚、不改列、不改账号模型。

**Non-Goals:**
- 不删 `groups.platform` 列（157 处引用 / 46 文件 / 63 处 `== PlatformComposite` 分支；纯重构风险高收益低）。
- 不引入"分组 × 平台"媒体价格矩阵。
- 不改 `accounts.platform`、渠道按平台的定价/映射模型。
- 不改 fail-closed 模型识别策略。

## Decisions

### D1：保留列，全部归一为 `composite`

`groups.platform` 保留，语义从"该分组所属平台"改为"分组形态标记，恒为 `composite`"。

- `NormalizeGroupPlatform("")` 由返回 `anthropic` 改为返回 `composite`（`group.go:414`）。
- 创建/更新路径忽略请求中的 `platform`，落库恒为 `composite`（`admin_group.go` CreateGroup/UpdateGroup 入口归一）。
- 迁移 `249_universal_group_platform.sql`：`UPDATE groups SET platform='composite' WHERE platform<>'composite';` 并把列默认值改为 `composite`。可重入。
- 好处：所有既有 `Platform == PlatformComposite` 分支自动全部生效，无需逐处改造；`isPlatformPricingMatch` / `matchingPlatforms` / 模型广场 / 可用渠道 / 用量日志平台推导这些已经 composite-aware 的代码直接复用。
- 备选（否决）：删除列。否决理由：需要改动 157 处引用，且会丢失"这是全平台分组"的显式标记，回滚成本高。

### D2：调度仍按"解析后平台"过滤账号（安全底线，不删）

分组去平台化**不等于**账号选择去平台化。`isAccountAllowedForPlatform`（`gateway_scheduling.go:1233`）、`NormalizeOpenAICompatiblePlatform`、Gemini `isAccountValidForPlatform` 必须保留；它们的作用是保证 Anthropic 请求不会拿到 OpenAI 的 token（凭证误用 + 错计费）。

要改的是"平台由 group 决定"→"平台由请求解析决定"这一层：
- `gemini_messages_compat_service.go:172`：`resolvePlatformAndSchedulingMode` 必须先读 `ResolvedTargetPlatformFromContext`，缺失时再回退 `DetectModelPlatform(model)`，最后才回落分组平台（改造后为 `composite`，应视为不可调度）。
- `handler/composite_platform.go:14/26/43/67/85`：这些 helper 的 `group.Platform != PlatformComposite` 早退条件改成恒真（即无条件执行解析），否则解析链在"平台解析未命中"的路径上会绕过。

### D3：解除 6 处单平台 sanitizer（防静默丢配置）

| 位置 | 现状 | 改为 |
|---|---|---|
| `group.go:465 profitControlPlatformSupported` | 排除 composite → 利润控制被重置为关/0/0 | 加入 `PlatformComposite` |
| `group_codex_models_manifest.go:23 normalizeCodexModelsManifestConfig` | 非 openai 清零 | 允许 composite；账号成员校验仍要求 `acc.Platform == openai` |
| `openai_messages_dispatch.go:115 sanitizeGroupMessagesDispatchFields` | 非 openai 清空 `default_mapped_model` + mappings | 允许 composite 保留 |
| `admin_group.go:568/880 allow_batch_image_generation` | 仅 gemini | 允许 composite |
| `admin_group.go:350 DefaultAllowImageGenerationForPlatform` | composite 返回 false | composite 返回 true（与 gemini/grok/antigravity 一致） |
| `admin_group.go:677/1105 AllowLive`、`sanitizeGroupOpenAIFast` | 已含 composite | 不变（保持） |

额外两处：
- `validateFallbackGroupOnInvalidRequest`（`admin_group.go:776`）：允许 composite 作为当前分组与兜底分组（原要求 anthropic）。
- `admin_group.go:567 imageCountBilling`：已含 composite，不变。

前端对应：`groupsProfitControl.ts` 平台集合加入 `composite`；`groupsImagePricing.ts` 的 `defaultAllowImageGenerationForPlatform` 加入 `composite`；`groupsSupportedModelScopes.ts` 对 composite 保留传入 scopes 而不是返回 `[]`。

### D4：修 4 个现存 composite 缺陷

1. **Gemini messages 平台解析缺失**（`gemini_messages_compat_service.go:172`）：见 D2，改造后为 P0（所有 Gemini messages 流量都会选 0 账号）。
2. **账号统计定价永不命中**（`account_stats_pricing.go:52`）：`GetGroupPlatform` 返回 `composite`，`isPlatformMatch` 精确比较永不匹配 → 静默回落 LiteLLM。改为用账号自身的 `Platform` 作为查询平台（账号统计天然按账号维度）。
3. **inflight 估费固定 openai**（`billing_inflight_reservation.go:757`）：`platform` 计算改为"ctx 解析平台 → 账号平台 → openai"。
4. **用户×平台配额被跳过**（`gateway_usage_billing.go:123 QuotaPlatform`）：composite 未解析时返回 `""` 导致配额不累加。改为：ctx 无解析结果时回退到调用方传入的账号平台；handler 侧调用点已在解析之后（`ensureCompositeTargetPlatform` 先执行），保留现有顺序。

其它按平台过滤、改造后语义仍成立的（保留不删，仅视为恒真/无操作）：`user_subscription_repo.go:249`（`GET /admin/subscriptions?platform=` 过滤恒匹配）、`custom_admin_key_group_models.go:64`（授权规则里的平台维度恒匹配）。

### D5：简单模式合并为单一默认分组

- `ensureSimpleModeDefaultGroups`（`repository/simple_mode_default_groups.go:19`）由"每平台种子"改为"确保存在一个名为 `default` 的 composite 分组"；历史 `*-default` 分组**保留不删**（已绑账号、已有用量），只是不再新建。
- `IsGroupBindableInSimpleMode`（`group.go:148`）改为恒真。
- `group_repo.ListBindableWithFilters:477` 去掉 `platform <> 'composite'` 过滤。
- `handler/admin/account_handler.go:256-320` 简单模式下隐藏 composite 分组的逻辑删除。
- `admin_account.go:501` 自动绑定默认分组：原来按 `ListActiveByPlatform(platform)` 找 `<platform>-default`；改为先找同名 `<platform>-default`（历史分组，若存在），否则找 `default`。
- `group_handler.go:651`、`admin_group.go:427/810` 的"简单模式禁止 composite"校验删除。

### D6：媒体价格保持一套价卡

分组只有一组 `image_price_1k/2k/4k`、`video_price_480p/720p/1080p`、`audio_*` 列。全平台分组下，这些价格对所有平台生效（图片按尺寸档、视频按分辨率档、语音按时长/字符/次）。需要按平台区分时使用已有的 `channel_model_pricing`（`model_pricing`，带 per-entry `platform`）。不新增列、不新增表。

### D7：管理端接口契约

- `CreateGroupRequest.Platform` / `UpdateGroupRequest.Platform`：`binding` 从 `omitempty,group_platform` 改为不校验（保留字段以兼容旧客户端），值被忽略。
- 响应中的 `platform` 恒为 `composite`。
- `GET /admin/groups?platform=` 过滤保留：非 `composite` 值返回空列表（不再有单平台分组）。
- `GET /admin/groups/all?platform=` 同上。
- `model-allowlist-candidates?platform=`：参数保留，候选模型改为"按 composite 合并所有平台候选"。
- 已废弃但保留：`handler/admin/platform_validation.go` 的 `group_platform` tag 仅供 `composite_model_routes.target_platform` 之外的旧引用。

## Risks

| 风险 | 缓解 |
|---|---|
| 未知模型名 → 403 影响面从"少数 composite 分组"扩到全站 | 保留 fail-closed；在文档与错误信息中给出模型名前缀写法（`openai/gpt-5`、`anthropic/claude-*`）；e2e 覆盖各网关入口的平台解析 |
| 混合账号池导致平台错配（凭证误用） | `isAccountAllowedForPlatform` 等门禁不删；新增单元测试：composite 分组下 Anthropic 请求不会选中 OpenAI 账号 |
| 迁移后回滚 | 迁移只改 `platform` 取值，`.down` 无法精确还原（信息已丢），因此先在备份分支保留快照；迁移文件只做单向 `UPDATE`，可重复执行 |
| 分组复制/账号复制跨平台 | `canCopyAccountsFromGroupPlatform` 在 composite 目标下已放宽，改造后源恒为 composite → 恒真 |
| 利润控制在全平台下的语义 | 按"分组级统一配置"处理：账号准入按该账号自身 `RateMultiplier` 与分组倍率比较，与目标平台无关（沿用现有实现，不新增平台维度） |
