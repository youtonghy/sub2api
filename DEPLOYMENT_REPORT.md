╔════════════════════════════════════════════════════════════════════╗
║           Responses Lite parallel_tool_calls 修复部署报告          ║
╚════════════════════════════════════════════════════════════════════╝

✅ 部署状态：成功

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 部署信息
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

部署时间：2026-08-23 14:45:24 (Asia/Shanghai)
部署版本：4b85df123 (responses-lite-fix)
构建时间：2026-08-23T06:39:41Z
容器 ID：a8fbe26fbaa0
镜像标签：sub2api:responses-lite-fix

前置版本：codex-parallel-fix-v3
备份容器：sub2api-backup-1787467524 (已删除)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 修复内容总结
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

问题：X-OpenAI-Internal-Codex-Responses-Lite requires parallel_tool_calls to be false

根本原因：
  Responses Lite 端点要求 parallel_tool_calls 必须显式设置为 false。
  之前的代码只在字段为 true 时改写，字段缺失时不处理，导致请求被拒绝。

修复方案：
  ✅ 新增 forceOpenAIParallelToolCallsFalse 函数
     - 强制设置 parallel_tool_calls=false
     - 即使字段缺失也会添加
  
  ✅ 新增 openAIRequestBodyHasEffectiveTools 函数
     - 检测顶层 tools 和 Lite 的 additional_tools
     - 确保有工具时保留 parallel_tool_calls
  
  ✅ 统一 Lite 检测逻辑
     - Lite 请求 → forceOpenAIParallelToolCallsFalse
     - 非 Lite + 设置 → rewriteOpenAIParallelToolCallsToFalse

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 修改统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Commit 8e38df6ec - WebSocket 路径修复
  • openai_ws_forwarder_ingress.go
  • openai_ws_v2_passthrough_adapter.go (2处)

Commit 4b85df123 - HTTP 路径修复 + 测试
  • openai_gateway_forward.go
  • openai_gateway_passthrough.go
  • openai_gateway_request_body.go
  • openai_gateway_request_body_reasoning_test.go
  • openai_responses_lite_tools_test.go

总计：7 个文件，+217 行，-22 行，3 个新测试

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 部署验证
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 容器状态：✅ Running (healthy)
   a8fbe26fbaa0   sub2api:responses-lite-fix   Up 10 seconds (healthy)

2. 健康检查：✅ Passed
   HTTP GET http://localhost:8080/health → {"status": "ok"}

3. 版本验证：✅ Confirmed
   Sub2API 0.1.179 (commit: docker, built: 2026-08-23T06:39:41Z)

4. 函数验证：✅ Deployed
   Binary contains: forceOpenAIParallelToolCallsFalse

5. 服务启动：✅ Normal
   - Database connection: OK
   - Redis connection: OK
   - All background services started
   - HTTP server listening on 0.0.0.0:8080

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 修复覆盖路径
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HTTP 路径：
  ✅ openai_gateway_forward.go (buildUpstreamRequest)
  ✅ openai_gateway_passthrough.go (buildUpstreamRequestOpenAIPassthrough)

WebSocket 路径：
  ✅ openai_ws_forwarder_ingress.go (ProxyResponsesWebSocketFromClient)
  ✅ openai_ws_v2_passthrough_adapter.go (proxyResponsesWebSocketV2Passthrough)
     - 首帧处理
     - 后续帧处理

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 部署流程
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ✅ 代码推送到远程仓库
   git push origin main → github.com:youtonghy/sub2api.git

2. ✅ 构建 Docker 镜像
   docker build -t sub2api:responses-lite-fix -f deploy/Dockerfile .
   Image size: ~124 MB

3. ✅ 原子部署执行
   - 捕获旧容器配置
   - 重命名旧容器为备份
   - 停止旧容器
   - 启动新容器（相同配置）
   - 等待健康检查通过
   - 删除备份容器

4. ✅ 部署结果：成功
   总耗时：~10 秒
   回滚次数：0
   服务中断：< 5 秒

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 后续监控建议
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 监控错误日志（24-48 小时）
   docker logs -f sub2api 2>&1 | grep -i "parallel_tool_calls"
   
   预期：不应出现 "requires parallel_tool_calls to be false" 错误

2. 监控 Responses Lite 请求
   docker logs -f sub2api 2>&1 | grep -i "responses-lite"
   
   预期：请求正常处理，无拒绝错误

3. 性能监控
   - 响应时间应无明显变化
   - CPU/内存使用正常
   - 并发处理能力未受影响

4. 功能测试（可选）
   参考 DEPLOYMENT_CHECKLIST.md 中的测试用例：
   - Lite + tools + parallel_tool_calls 缺失
   - Lite + tools + parallel_tool_calls: true
   - Lite + namespace tools
   - WebSocket Lite 请求
   - 非 Lite 请求（回归测试）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 相关文档
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ DEPLOYMENT_SUMMARY.md   - 详细修复说明和历史
✅ DEPLOYMENT_CHECKLIST.md - 完整的部署检查清单
✅ PR #6084                - 参考 PR

Git commits:
  8e38df6ec - fix: force parallel_tool_calls=false for Responses Lite WebSocket paths
  4b85df123 - fix: use forceOpenAIParallelToolCallsFalse for Responses Lite in HTTP paths

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

部署完成时间：2026-08-23 14:45:34 (Asia/Shanghai)
部署执行人：AI Agent (Claude)
部署状态：✅ 成功
服务状态：✅ 正常运行

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
