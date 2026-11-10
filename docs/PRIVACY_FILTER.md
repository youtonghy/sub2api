# 隐私过滤

隐私过滤在请求转发到上游账号之前，把用户文本和工具结果里的敏感信息替换成占位符。“脱敏”模式的占位符是 `[REDACTED:类型]`，不可还原；“可还原脱敏”模式的占位符是 `[REDACTED:类型:哈希]`，回复返回客户端前会换回原值。

这是尽力而为的措施，不是安全边界。检测基于规则和校验算法，既可能漏检也可能误伤。

## 配置

在后台“风控中心 > 隐私过滤”配置，默认关闭，配置保存在设置项 `privacy_filter_config`。多实例部署时，其他实例最多 5 秒后生效。

| 模式 | 行为 |
|---|---|
| 关闭 | 不扫描任何请求 |
| 仅统计 | 扫描所选分组的请求并按类别计数，请求不变 |
| 脱敏 | 替换所选分组请求中的命中内容；处理失败时拒绝请求，不转发原文 |
| 可还原脱敏 | 上游只看到占位符，回复在返回客户端前换回原值；处理失败时拒绝请求 |

只对选中的分组生效。建议先用“仅统计”观察一段时间，再切换到“脱敏”。统计只含类别和次数，不记录命中的原文；计数按进程统计，重启后清零。

| 类别 | 标识 | 默认 |
|---|---|---|
| 私钥 | `private_key` | 开 |
| 公钥 | `public_key` | 关 |
| 密码与令牌 | `credential` | 开 |
| 银行卡与 IBAN | `financial` | 开 |
| 身份证件号 | `identity` | 开 |
| 代理与 VPN 节点凭据 | `proxy` | 开 |
| 邮箱地址 | `email` | 关 |
| IP 地址 | `ip` | 关 |

接口：`GET`/`PUT /api/v1/admin/risk-control/privacy-filter/config`，`GET /api/v1/admin/risk-control/privacy-filter/status`。

## 处理范围

过滤在安全审计之前执行，所以审计记录和第三方审核服务拿到的也是脱敏后的文本。

| 协议 | 处理的字段 |
|---|---|
| Anthropic Messages、count_tokens | `user` 消息的文本、`tool_result`、纯文本 `document` |
| OpenAI Chat Completions | `user`、`tool`、`function` 消息的文本 |
| OpenAI Responses（HTTP 与 WebSocket 每一轮） | `user` 输入的文本、各类 `*_output` |
| Gemini、cachedContents | 非 `model` 角色的文本、`functionResponse.response` 的字符串值 |
| Embeddings | `input` 文本 |

## 可还原脱敏

占位符后缀是用服务端密钥（由已持久化的 JWT secret 派生）对原值和 API Key 计算的 HMAC。同一个 API Key 下同一个值每轮得到同一个占位符，所以 prompt 缓存可以命中；不同 API Key 之间无法关联，上游也无法离线猜测原值。

- 原值只保存在本次请求的内存里；Responses WebSocket 在本条连接内累计，每条连接最多 20000 个。不落库，不写日志，不进缓存。
- 还原发生在写给客户端的最后一步，按客户端协议处理，与上游协议和中间的协议转换无关。流式输出里被拆开的占位符会先暂存，拼完整后再还原。
- 还原的位置：正文、工具调用参数（含 Anthropic `input_json_delta`、Chat `tool_calls`、Responses `function_call_arguments`）、最终消息和 `response.completed`。thinking 和推理摘要带签名，不还原；错误响应不还原。
- 客户端拿到原值后会在下一轮历史里发回来。网关会在 assistant 历史和工具调用参数里把已知原值精确换回占位符，使发给上游的内容与上游上一轮的输出一致。
- 后台状态里的“已还原 / 未能还原”统计占位符次数。“未能还原”通常来自 `previous_response_id` 引用的上游历史，或客户端压缩过、已不含原文的历史。
- Gemini 不带 `alt=sse` 的流式请求会被整段缓冲后再返回，失去逐段输出。

## 不处理的内容

- `system`、`instructions` 等系统提示，工具定义，以及 assistant 历史（thinking 带签名，改动会被上游拒绝）。
- 图片、PDF、音频里的内容，图片生成、Grok 媒体、Live 语音和 System One 接口。
- 已存在上游的状态，例如 `previous_response_id` 指向的历史和开启前创建的 Gemini cachedContents。
- “脱敏”模式下模型的回复（仍是占位符）。

## 对业务的影响

- 编码 Agent 读到占位符后，可能无法按原文编辑文件，也无法连接被隐藏的地址。
- 相同文本的替换结果固定，开启后 prompt 缓存可以正常命中。切换模式、类别或升级规则时，缓存前缀会失效一次。
- 大文本块按内容哈希缓存结果，历史消息不会重复扫描，缓存中只保存脱敏后的文本。
