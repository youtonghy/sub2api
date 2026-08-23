# Responses Lite parallel_tool_calls 修复部署总结

## 问题描述
错误信息：`X-OpenAI-Internal-Codex-Responses-Lite requires parallel_tool_calls to be false`

Responses Lite 端点要求 `parallel_tool_calls` 必须**显式设置为 false**，即使字段缺失也会导致请求被拒绝。

## 修复历史

### 1. Commit 7c1ef63eb - Add setting to rewrite parallel tool calls to false
- 添加了设置选项来重写 `parallel_tool_calls` 为 false
- 引入了 `rewriteOpenAIParallelToolCallsToFalse` 函数（只处理显式为 true 的情况）

### 2. Commit 778458861 - Normalize Responses Lite parallel tool calls across gateway paths  
- 添加了 Responses Lite header 检测
- 但仍使用 `rewriteOpenAIParallelToolCallsToFalse`（不完整的修复）

### 3. Commit 8e38df6ec - fix: force parallel_tool_calls=false for Responses Lite WebSocket paths ✅
**修复 WebSocket 路径**
- 修改 `openai_ws_forwarder_ingress.go`
- 修改 `openai_ws_v2_passthrough_adapter.go`  
- 使用 `forceOpenAIParallelToolCallsFalse` 确保字段显式存在

### 4. Commit 4b85df123 - fix: use forceOpenAIParallelToolCallsFalse for Responses Lite in HTTP paths ✅
**修复 HTTP 路径**
- 修改 `openai_gateway_forward.go` - buildUpstreamRequest
- 修改 `openai_gateway_passthrough.go` - buildUpstreamRequestOpenAIPassthrough
- 修改 `openai_gateway_request_body.go` - 添加 `forceOpenAIParallelToolCallsFalse` 和 `openAIRequestBodyHasEffectiveTools`
- 添加测试：`openai_gateway_request_body_reasoning_test.go`
- 添加集成测试：`openai_responses_lite_tools_test.go`

## 关键函数对比

### rewriteOpenAIParallelToolCallsToFalse (旧逻辑)
```go
// 只在 parallel_tool_calls=true 时改为 false
// 如果字段缺失，不做任何处理 ❌
if parallel.Type != gjson.True {
    return body, false, nil
}
```

### forceOpenAIParallelToolCallsFalse (新逻辑)  
```go
// 强制设置为 false，即使字段缺失 ✅
if gjson.GetBytes(body, "parallel_tool_calls").Type == gjson.False {
    return body, false, nil
}
normalized, err := sjson.SetBytes(body, "parallel_tool_calls", false)
```

## 修复覆盖的路径

### HTTP 路径 ✅
- ✅ `openai_gateway_forward.go` - buildUpstreamRequest (Lite 检测 + forceOpenAIParallelToolCallsFalse)
- ✅ `openai_gateway_passthrough.go` - buildUpstreamRequestOpenAIPassthrough (Lite 检测 + forceOpenAIParallelToolCallsFalse)

### WebSocket 路径 ✅  
- ✅ `openai_ws_forwarder_ingress.go` - ProxyResponsesWebSocketFromClient (Lite 检测 + forceOpenAIParallelToolCallsFalse)
- ✅ `openai_ws_v2_passthrough_adapter.go` - proxyResponsesWebSocketV2Passthrough (2处: 首帧 + 后续帧，Lite 检测 + forceOpenAIParallelToolCallsFalse)

### 支持功能 ✅
- ✅ `openAIRequestBodyHasEffectiveTools` - 检测顶层 tools 和 Lite 的 input.additional_tools

## 测试覆盖

1. **TestForceOpenAIParallelToolCallsFalse** - 测试强制设置函数
   - 缺失字段 → 强制添加为 false ✅
   - true → 改为 false ✅  
   - false → 保持不变 ✅

2. **TestNormalizeOpenAIParallelToolCallsWithoutToolsKeepsLiteAdditionalTools** - 测试 Lite additional_tools 检测
   - 有 additional_tools → 保留 parallel_tool_calls ✅
   - 空 additional_tools → 移除 parallel_tool_calls ✅

3. **TestOpenAIGatewayServiceForward_KeepsParallelToolCallsFalseForResponsesLiteAPIKey** - 集成测试
   - 测试 API Key 账号 + Responses Lite + namespace tools 的完整流程 ✅

## 部署步骤

### 1. 推送代码
```bash
git push origin main
```

### 2. 构建 Docker 镜像
```bash
# 在项目根目录
docker build -t sub2api:latest -f deploy/Dockerfile .
```

### 3. 部署到容器
```bash
# 根据 AGENTS.md 的指引
# 停止现有容器
docker stop sub2api

# 删除旧容器
docker rm sub2api

# 启动新容器
docker run -d --name sub2api \
  -p 8080:8080 \
  -v /path/to/config:/app/config \
  sub2api:latest
```

### 4. 验证修复
```bash
# 测试 Responses Lite 请求
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -H "X-OpenAI-Internal-Codex-Responses-Lite: true" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-5.6",
    "input": [{"type": "message", "role": "user", "content": "test"}],
    "tools": [{"type": "function", "name": "test"}]
  }'

# 应该不再出现 "requires parallel_tool_calls to be false" 错误
```

## 相关 PR
- GitHub PR #6084 (参考)

## 修复状态
✅ **完全修复** - 所有 HTTP 和 WebSocket 路径都已正确处理 Responses Lite 的 `parallel_tool_calls` 要求
