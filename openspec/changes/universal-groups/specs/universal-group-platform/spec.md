## Purpose

让分组不再归属单一平台：一个分组可以绑定任意平台的上游账号，管理员为它配一张订阅，用户拿到 Key 后即可按模型使用分组内所有平台的能力。分组仍是账号池、定价与权限的单位；平台由每次请求的模型解析得出。

## ADDED Requirements

### Requirement: 分组平台恒为全平台形态

系统 SHALL 把所有分组的 `platform` 归一为 `composite`。创建与更新分组接口 MUST 忽略请求携带的 `platform` 值；响应中的 `platform` MUST 恒为 `composite`。省略 `platform` 时 MUST NOT 回退到 `anthropic`。

#### Scenario: 创建分组不带平台
- **WHEN** 管理员创建分组且请求体不含 `platform`
- **THEN** 该分组落库的 `platform` MUST 为 `composite`

#### Scenario: 创建分组指定单平台
- **WHEN** 管理员创建分组时 `platform=openai`
- **THEN** 系统 MUST 忽略该值，落库 `platform` 为 `composite`
- **THEN** 接口 MUST 返回成功，MUST NOT 返回校验错误

#### Scenario: 更新分组平台
- **WHEN** 管理员对已存在分组提交 `platform=gemini`
- **THEN** 系统 MUST 保持 `platform` 为 `composite`

### Requirement: 一个分组可绑定任意平台账号

系统 MUST 允许同一个分组绑定来自不同 `accounts.platform` 的账号，MUST NOT 因平台不同拒绝绑定。分组内账号的平台差异 MUST NOT 影响分组的创建、更新、复制或删除。

#### Scenario: 混合平台绑定
- **WHEN** 一个分组同时绑定 anthropic、openai、gemini、grok 账号
- **THEN** 保存 MUST 成功
- **THEN** 该分组 MUST 对每个平台都可正常调度到对应账号

#### Scenario: 跨分组复制账号
- **WHEN** 管理员把某个分组的账号复制到另一个分组
- **THEN** 系统 MUST 允许复制全部账号，与账号平台无关

### Requirement: 请求按模型解析目标平台并在该平台账号池内调度

系统 MUST 为每个请求解析唯一的目标平台，MUST 只在该平台的账号中选账号。目标平台解析顺序 MUST 为：显式路由表命中、上下文已解析结果、账号模型归属、模型名前缀识别。解析 MUST 失败时返回客户端错误，MUST NOT 猜测平台，MUST NOT 回退到分组的 `composite` 值去匹配账号。

#### Scenario: Anthropic 模型在混合分组
- **WHEN** 请求 `claude-sonnet-4-5` 且分组同时含 openai 与 anthropic 账号
- **THEN** 系统 MUST 只选择 anthropic 账号
- **THEN** MUST NOT 把 openai 账号的凭据用于该请求

#### Scenario: 无法识别的模型名
- **WHEN** 请求的模型名既无显式路由也无法被识别
- **THEN** 系统 MUST 返回 4xx 客户端错误并说明模型无法定位平台
- **THEN** 系统 MUST NOT 调度任何账号

#### Scenario: 显式路由覆盖模型名推断
- **WHEN** 分组为公开模型 `my-alias` 配置了 `target_platform=openai` 的精确路由
- **THEN** 请求 `my-alias` MUST 解析为 openai 并只在 openai 账号池调度

### Requirement: 计费、计量与配额按解析平台归属

系统 MUST 按解析出的目标平台执行用户平台配额、渠道定价查找、用量日志平台标注与运营报错平台归属。MUST NOT 使用分组的 `platform` 值作为这些维度的取值。

#### Scenario: 用户平台配额
- **WHEN** 用户在 openai 平台配额 10 USD 下请求 `gpt-5` 且该请求解析为 openai
- **THEN** 该请求的用量 MUST 计入用户 openai 平台配额

#### Scenario: 渠道定价
- **WHEN** 渠道为 openai 平台配置了 `gpt-5` 的模型定价
- **THEN** 全平台分组下请求 `gpt-5` MUST 命中该定价

#### Scenario: 账号成本统计
- **WHEN** 统计某个 openai 账号的成本
- **THEN** 系统 MUST 按账号自身平台查询渠道定价，MUST NOT 用分组的 `platform` 查询

### Requirement: 简单模式使用单一全平台默认分组

简单模式启动时系统 MUST 确保存在一个名为 `default` 的全平台分组。系统 MUST NOT 再按平台创建 `<platform>-default` 分组；已存在的分组 MUST NOT 被删除。简单模式下分组 MUST 可正常绑定账号。

#### Scenario: 简单模式初始化
- **WHEN** 简单模式首次启动且无任何分组
- **THEN** 系统 MUST 创建名为 `default` 的单个分组

#### Scenario: 简单模式已有历史分组
- **WHEN** 简单模式启动且已存在 `anthropic-default` 等历史分组
- **THEN** 系统 MUST 保留它们
- **THEN** 系统 MUST NOT 因缺少新的按平台默认分组而重复创建

#### Scenario: 简单模式绑定分组
- **WHEN** 管理员在简单模式下把账号绑定到分组
- **THEN** 系统 MUST 接受，MUST NOT 以"平台不支持"为由拒绝

## MODIFIED Requirements

<!-- 该仓库 openspec/specs 目前为空，暂无既有能力条目需要修改。 -->
