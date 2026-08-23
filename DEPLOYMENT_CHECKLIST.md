# 部署前检查清单

## ✅ 代码修复验证

### 1. 函数使用检查
```bash
cd /home/dev/git/sub2api/backend
grep -n "forceOpenAIParallelToolCallsFalse" internal/service/*.go | grep -v "_test.go"
```

**预期结果：8 处使用**
- ✅ `openai_gateway_request_body.go:420` - 函数注释
- ✅ `openai_gateway_request_body.go:425` - 函数定义
- ✅ `openai_gateway_request_body.go:447` - normalizeOpenAIParallelToolCallsForUpstream 调用
- ✅ `openai_gateway_forward.go:1368` - HTTP forward 路径
- ✅ `openai_gateway_passthrough.go:699` - HTTP passthrough 路径
- ✅ `openai_ws_forwarder_ingress.go:329` - WebSocket ingress 路径
- ✅ `openai_ws_v2_passthrough_adapter.go:697` - WebSocket passthrough 首帧
- ✅ `openai_ws_v2_passthrough_adapter.go:1030` - WebSocket passthrough 后续帧

### 2. Commit 验证
```bash
git log --oneline -5
```

**预期结果：**
```
4b85df123 fix: use forceOpenAIParallelToolCallsFalse for Responses Lite in HTTP paths
8e38df6ec fix: force parallel_tool_calls=false for Responses Lite WebSocket paths
778458861 Normalize Responses Lite parallel tool calls across gateway paths
7c1ef63eb Add setting to rewrite parallel tool calls to false
...
```

### 3. 修改统计
```bash
git diff --stat 778458861..HEAD
```

**预期结果：**
- 7 个文件修改
- +217 行添加
- -22 行删除

## ✅ 部署步骤

### 步骤 1: 推送代码到远程
```bash
cd /home/dev/git/sub2api
git push origin main
```

### 步骤 2: 构建 Docker 镜像
```bash
# 在项目根目录
cd /home/dev/git/sub2api

# 构建镜像
docker build -t sub2api:responses-lite-fix -f deploy/Dockerfile .

# 或使用项目 Makefile
make build
```

### 步骤 3: 标记镜像版本
```bash
# 获取当前 commit hash
COMMIT_HASH=$(git rev-parse --short HEAD)
echo "Current commit: $COMMIT_HASH"

# 标记镜像
docker tag sub2api:responses-lite-fix sub2api:$COMMIT_HASH
docker tag sub2api:responses-lite-fix sub2api:latest
```

### 步骤 4: 停止现有服务
```bash
# 根据实际部署环境调整
docker stop sub2api
docker rm sub2api
```

### 步骤 5: 启动新容器
```bash
# 使用新镜像启动容器
docker run -d \
  --name sub2api \
  -p 8080:8080 \
  -v /path/to/config:/app/config \
  --restart unless-stopped \
  sub2api:latest

# 检查容器状态
docker ps | grep sub2api
docker logs -f sub2api
```

## ✅ 功能验证测试

### 测试 1: Responses Lite + tools + parallel_tool_calls 缺失
```bash
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -H "X-OpenAI-Internal-Codex-Responses-Lite: true" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-5.6",
    "input": [{"type": "message", "role": "user", "content": "test"}],
    "tools": [{"type": "function", "name": "test_function"}]
  }'
```
**预期：** 成功，不报错

### 测试 2: Responses Lite + tools + parallel_tool_calls: true
```bash
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -H "X-OpenAI-Internal-Codex-Responses-Lite: true" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-5.6",
    "parallel_tool_calls": true,
    "input": [{"type": "message", "role": "user", "content": "test"}],
    "tools": [{"type": "function", "name": "test_function"}]
  }'
```
**预期：** 成功，自动改为 false

### 测试 3: Responses Lite + namespace tools
```bash
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -H "X-OpenAI-Internal-Codex-Responses-Lite: true" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-5.6",
    "parallel_tool_calls": true,
    "tools": [{"type": "namespace", "name": "collaboration", "tools": [{"type": "function", "name": "spawn_agent"}]}],
    "input": [{"type": "message", "role": "user", "content": "test"}]
  }'
```
**预期：** 成功，namespace 转换为 additional_tools 后保留 parallel_tool_calls: false

### 测试 4: WebSocket Responses Lite
```bash
# 使用 wscat 或其他 WebSocket 客户端
wscat -c "ws://localhost:8080/v1/responses" \
  -H "X-OpenAI-Internal-Codex-Responses-Lite: true" \
  -H "Authorization: Bearer your-api-key"

# 发送消息
{
  "type": "response.create",
  "model": "gpt-5.6",
  "parallel_tool_calls": true,
  "tools": [{"type": "function", "name": "test"}],
  "input": [{"type": "message", "role": "user", "content": "test"}]
}
```
**预期：** 连接成功，消息正常处理

### 测试 5: 非 Lite 请求（回归测试）
```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4",
    "parallel_tool_calls": true,
    "messages": [{"role": "user", "content": "test"}],
    "tools": [{"type": "function", "name": "test_function", "parameters": {"type": "object"}}]
  }'
```
**预期：** 正常工作，parallel_tool_calls 保持为 true

## ✅ 监控检查

### 1. 检查错误日志
```bash
# 查找 parallel_tool_calls 相关错误
docker logs sub2api 2>&1 | grep -i "parallel_tool_calls"

# 查找 Responses Lite 错误
docker logs sub2api 2>&1 | grep -i "responses-lite"
```

**预期：** 无 "requires parallel_tool_calls to be false" 错误

### 2. 检查请求成功率
```bash
# 查看最近的请求统计
docker logs sub2api --tail 1000 | grep -E "(200|400|500)" | wc -l
```

### 3. 性能监控
- 响应时间无明显增加
- CPU/内存使用正常
- 并发处理能力未受影响

## ✅ 回滚计划

如果出现问题，执行以下步骤回滚：

```bash
# 1. 停止新容器
docker stop sub2api
docker rm sub2api

# 2. 重新启动旧版本
docker run -d \
  --name sub2api \
  -p 8080:8080 \
  -v /path/to/config:/app/config \
  --restart unless-stopped \
  sub2api:<previous-commit-hash>

# 3. 验证服务正常
curl http://localhost:8080/health
```

## ✅ 部署签收

- [ ] 代码已推送到远程仓库
- [ ] Docker 镜像构建成功
- [ ] 新容器启动成功
- [ ] 功能测试全部通过
- [ ] 无错误日志
- [ ] 性能监控正常
- [ ] 已通知相关团队成员

部署人员：________________  
部署时间：________________  
部署版本：4b85df123

---

**相关文档：**
- [DEPLOYMENT_SUMMARY.md](./DEPLOYMENT_SUMMARY.md) - 详细的修复说明
- PR #6084 - 参考 PR
