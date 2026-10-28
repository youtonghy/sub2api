## Why

分组（groups）目前必须归属单一平台（`anthropic` / `openai` / `gemini` / ...），因此一家客户想同时使用 Claude、GPT、Gemini、Grok 就必须被拆成多个分组、买多份订阅、拿多个 API Key。运营上无法用"一个套餐卖全家桶"，管理端也要为每个平台重复建分组、重复配价、重复分配。

产品诉求：**一个分组可以绑定任意平台的账号，一张订阅即可访问该分组下的全部平台能力**。分组不再是"平台的分区"，而是"账号池 + 定价 + 权限"的单位；请求进来时由模型名决定走哪个上游平台。

代码里已有这个能力的内核 —— 平台值为 `composite` 的"组合分组"已经实现了按模型解析目标平台、跨平台选账号、按解析平台计费/计量/查价，并且订阅侧（`subscription_plans` / `user_subscriptions`）本来就只绑 `group_id`、无平台限制。问题是 composite 是"例外分支"，且被一批单平台 sanitizer 与 UI 门槛刻意排除在很多功能之外。本变更把 composite 变成**唯一形态**，并补齐它被排除的能力。

## What Changes

- **BREAKING**（数据语义）：`groups.platform` 列保留，但全部取值归一为 `composite`。迁移回填所有现存分组；创建/更新接口忽略并强制该值，管理端不再提供平台选择器。
- **BREAKING**（调度语义）：分组不再限制平台，但**每次请求仍按模型解析出目标平台，只在该平台账号池中调度**。这一步不可去除，否则会把 OpenAI 凭证发往 Anthropic 上游。
- 解除单平台 sanitizer：利润控制、Codex 固定账号 manifest、Messages 调度模型映射、批量生图、`allow_live`、OpenAI Fast、无效请求兜底分组，全部在 `composite` 分组上生效（原先是静默清零）。
- 修复现存 composite 缺陷：Gemini `messages` 兼容路径不解析目标平台导致选不到账号；账号统计定价用原始 `composite` 精确匹配渠道价；OpenAI inflight 估费在 composite 下固定按 openai 计；`QuotaPlatform` 未解析时跳过用户×平台配额。
- 简单模式：默认分组由"每平台一个"合并成单个全平台默认分组，分组在简单模式下可正常绑定。
- 前端：删除分组创建/编辑的平台选择器，把所有 `v-if platform===xxx` 的配置区块改为无条件展示；用户侧 API Key 创建的"厂商"选择步骤取消；修正提交时对非 antigravity 分组清空 `supported_model_scopes` 的行为。

## Capabilities

### New Capabilities
- `universal-group-platform`：分组平台归一化、迁移回填、管理端接口契约与调度/计费语义。
- `universal-group-config`：原本按平台隔离的分组配置（利润控制、Codex manifest、Messages 映射、媒体价格、生图开关、兜底分组）在全平台分组上的生效规则。

### Modified Capabilities
<!-- openspec/specs 目前为空，没有既有能力需要修改。 -->

## Non-goals

- 不删除 `groups.platform` 列，也不重命名；不做"分组无关平台"的大规模重构（157 处引用、46 个文件）。
- 不改变"按模型解析目标平台"的 fail-closed 行为：无法识别模型名时仍返回 403，不猜默认平台。
- 不为媒体价格引入"分组 × 平台"价格维度：图片/视频/语音沿用分组上的一套价格列，多平台共用同一张价卡。
- 不改动 `accounts.platform`：账号仍然属于具体平台，只有分组变成全平台。
- 不改动渠道（channel）按具体平台配置定价/映射的数据模型。
- 不改变上游协议、计费算法与限流逻辑。

## Impact

- **数据库**：新增迁移 `backend/migrations/249_universal_group_platform.sql`：`UPDATE groups SET platform='composite' WHERE platform<>'composite'`；`groups.platform` 默认值改为 `composite`；简单模式下 `*-default` 分组按名称合并时保留账号绑定（不删除历史分组）。
- **后端**：`internal/domain/platforms.go`（平台清单语义说明）、`internal/service/group.go`（`NormalizeGroupPlatform`、利润控制平台集合）、`admin_group.go`（8 处平台 sanitizer / 校验）、`group_codex_models_manifest.go`、`openai_messages_dispatch.go`、`openai_reasoning_effort_policy.go`、`gemini_messages_compat_service.go`、`account_stats_pricing.go`、`billing_inflight_reservation.go`、`gateway_usage_billing.go`、`repository/simple_mode_default_groups.go`、`repository/group_repo.go`、`repository/user_subscription_repo.go`、`repository/custom_admin_key_group_models.go`、`handler/admin/group_handler.go`、`handler/admin/platform_validation.go`。
- **管理端 API**：`POST/PUT /admin/groups` 的 `platform` 变为只读派生字段（传入值被忽略，响应恒为 `composite`）；`GET /admin/groups?platform=` 过滤保留但仅 `composite` 有意义。
- **前端**：`views/admin/GroupsView.vue`、`views/admin/groups*.ts` 辅助模块、`views/user/KeysView.vue`、`views/admin/SubscriptionsView.vue`、`views/admin/ChannelsView.vue`、`components/admin/orders/PlanEditDialog.vue`、`constants/platforms.ts`、`types/index.ts`、中英文 i18n。
- **文档**：`docs/COMPOSITE_GROUPS.md` 改为描述"全平台分组"（分组默认形态），不再是可选形态。
