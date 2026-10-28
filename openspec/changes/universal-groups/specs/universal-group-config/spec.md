## Purpose

原本只在特定平台分组上生效、或对全平台分组静默清零的分组级配置，在全平台分组上必须可用且不得在保存时丢失。包括利润控制、Codex 固定账号 manifest、Messages 调度模型映射、图片/视频/语音定价、生图开关、OpenAI Fast、Live、无效请求兜底分组。

## ADDED Requirements

### Requirement: 分组配置不得因平台而为空

系统 MUST 在创建与更新分组时保留管理员提交的所有分组级配置。MUST NOT 因为分组平台不是某个具体平台而把配置重置为默认值。

#### Scenario: 保存利润控制
- **WHEN** 管理员在全平台分组上开启利润控制并设置最低毛利率 30%
- **THEN** 保存后该分组 MUST 仍为开启且毛利率为 0.30

#### Scenario: 保存 Codex 固定账号 manifest
- **WHEN** 管理员在全平台分组上开启 Codex manifest 固定账号并选择 2 个 openai 账号
- **THEN** 保存后该配置 MUST 保留

#### Scenario: 保存 Messages 调度模型映射
- **WHEN** 管理员在全平台分组上配置 Opus/Sonnet/Haiku 的目标模型映射
- **THEN** 保存后 `default_mapped_model` 与映射矩阵 MUST 保留

#### Scenario: 保存批量生图
- **WHEN** 管理员在全平台分组上开启图片生成与批量生图
- **THEN** 保存后两个开关 MUST 都为开启

#### Scenario: 保存 Antigravity 模型作用域
- **WHEN** 管理员在全平台分组上勾选 `claude` 与 `gemini_text` 模型作用域
- **THEN** 保存后 `supported_model_scopes` MUST 保留这两个值
- **THEN** 前端 MUST NOT 提交空数组覆盖它们

### Requirement: 单平台功能在全平台分组上的准入规则

利润控制、Codex 固定账号 manifest 与 Messages 调度模型映射的准入校验 MUST 保留其数据约束，但 MUST NOT 以分组平台为由拒绝或清零。

- 利润控制：毛利率与安全缓冲各自 ∈ [0,1) 且之和 < 1。
- Codex 固定账号 manifest：开启时至少 1 个、至多 10 个账号，且每个账号 MUST 是当前分组内 active 的 `openai` 平台账号。
- Messages 调度模型映射：仅在 `allow_messages_dispatch` 开启时生效。

#### Scenario: Codex manifest 选中非 openai 账号
- **WHEN** 全平台分组的 Codex manifest 配置包含一个 gemini 平台账号
- **THEN** 系统 MUST 返回 400，错误码 `INVALID_CODEX_MODELS_MANIFEST_CONFIG`

#### Scenario: 利润控制数值越界
- **WHEN** 管理员提交毛利率 0.7 且安全缓冲 0.4
- **THEN** 系统 MUST 返回 400，因为两者之和 >= 1

### Requirement: 媒体价格对分组内所有平台生效

分组只持有一套媒体价格：图片按 `1K/2K/4K` 尺寸档、视频按 `480p/720p/1080p` 分辨率档、语音按实时分钟 / TTS 字符 / STT 小时。这些价格 MUST 对分组内所有平台生效。需要按平台区分价格时 MUST 使用渠道模型定价的 per-entry `platform` 字段，MUST NOT 新增分组级平台价格矩阵。

#### Scenario: 图片价格跨平台
- **WHEN** 全平台分组配置 `image_price_2k = 0.2` 且请求命中 gemini 图片生成
- **THEN** 该请求 MUST 按 0.2 计费
- **THEN** 命中 openai 图片生成时 MUST 同样按 0.2 计费

#### Scenario: 视频价格
- **WHEN** 全平台分组配置 `video_price_720p = 0.07` 且请求命中 grok 视频生成
- **THEN** 该请求 MUST 按 0.07 每秒计费

### Requirement: 无效请求兜底分组

全平台分组 MUST 允许配置无效请求兜底分组。兜底分组 MUST 保留约束：不得为自身、不得为订阅类型、不得自身再配置兜底。

#### Scenario: 设置兜底分组
- **WHEN** 管理员为非订阅的全平台分组设置另一个非订阅全平台分组作为无效请求兜底
- **THEN** 保存 MUST 成功

#### Scenario: 订阅分组设置兜底
- **WHEN** 管理员为订阅类型分组设置无效请求兜底
- **THEN** 系统 MUST 返回 400

### Requirement: OpenAI 与 Antigravity 专属开关在全平台分组上可用

`allow_live`、`force_openai_fast`、`free_openai_fast`、`mcp_xml_inject`、`allow_messages_dispatch` MUST 可在全平台分组上开启并持久化。运行时 MUST 仅在请求解析到对应平台时生效。

#### Scenario: 开启 Live 但请求解析为 anthropic
- **WHEN** 全平台分组开启 `allow_live` 且请求模型解析为 anthropic
- **THEN** 系统 MUST 按 anthropic 正常处理该请求
- **THEN** Live 开关 MUST NOT 产生副作用

#### Scenario: 开启 Fast 且请求解析为 openai
- **WHEN** 全平台分组开启 `force_openai_fast` 且请求解析为 openai
- **THEN** 上游请求 MUST 使用 `service_tier=priority`

## MODIFIED Requirements

<!-- 该仓库 openspec/specs 目前为空，暂无既有能力条目需要修改。 -->
