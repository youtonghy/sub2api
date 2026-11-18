package handler

import (
	pkghttputil "github.com/Wei-Shaw/sub2api/internal/pkg/httputil"
	"github.com/Wei-Shaw/sub2api/internal/pkg/requestmodel"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const compositePlatformFallbackStateKey = "composite_platform_fallback_state"

// compositePlatformFallbackState 跟踪一次请求的 composite 跨平台优先级回退。
//
// 每个平台各跑一遍完整的 handler（单平台尝试），平台相关的派生量（渠道映射、
// reasoning 策略、配额平台、在途余额预留、会话哈希等）都由同一段代码按新平台
// 重新计算，而不是在切换时逐项重置；上一次尝试的 defer（并发槽、余额预留、隐私
// 还原）在下一次尝试开始前已全部释放。
type compositePlatformFallbackState struct {
	remaining   []string
	attempted   []string
	next        string
	switchCount int
}

// runWithCompositePlatformFallback 按 ctx 中的平台序列执行 attempt。没有回退
// 序列时直接执行一次，行为与原来完全一致。
func runWithCompositePlatformFallback(c *gin.Context, endpoint string, attempt func(*gin.Context)) {
	if c == nil || c.Request == nil {
		attempt(c)
		return
	}
	remaining := service.CompositeFallbackPlatformsFromContext(c.Request.Context())
	if len(remaining) == 0 {
		attempt(c)
		return
	}
	// 每次尝试都从原始请求体与入口 ctx 出发，避免上一平台的 body 改写
	// （reasoning 策略、渠道映射）或 ctx 绑定带入下一平台。
	body, err := pkghttputil.ReadRequestBodyWithPrealloc(c.Request)
	if err != nil {
		// 交给 attempt 按原有路径报告读取错误；不回退。
		attempt(c)
		return
	}
	requestmodel.ResetRequestBody(c.Request, body)
	baseCtx := c.Request.Context()
	current, _ := service.ResolvedTargetPlatformFromContext(baseCtx)

	state := &compositePlatformFallbackState{remaining: remaining, attempted: []string{current}}
	c.Set(compositePlatformFallbackStateKey, state)
	defer c.Set(compositePlatformFallbackStateKey, nil)

	for {
		state.next = ""
		attempt(c)
		if state.next == "" || c.Writer.Written() || c.IsAborted() {
			return
		}
		requestLogger(c, "handler.composite_platform_fallback").Info("composite.cross_platform_fallback",
			zap.String("endpoint", endpoint),
			zap.String("from_platform", state.attempted[len(state.attempted)-1]),
			zap.String("to_platform", state.next),
			zap.Strings("remaining_platforms", state.remaining),
			zap.Int("switch_count", state.switchCount),
		)
		state.attempted = append(state.attempted, state.next)
		c.Request = c.Request.WithContext(service.WithCompositeFallbackPlatform(baseCtx, state.next))
		requestmodel.ResetRequestBody(c.Request, body)
	}
}

func compositePlatformFallbackStateFrom(c *gin.Context) *compositePlatformFallbackState {
	if c == nil {
		return nil
	}
	value, ok := c.Get(compositePlatformFallbackStateKey)
	if !ok {
		return nil
	}
	state, _ := value.(*compositePlatformFallbackState)
	return state
}

// compositeFallbackInitialSwitchCount 让账号切换次数跨平台累计，总数仍受
// gateway.max_account_switches 约束。
func compositeFallbackInitialSwitchCount(c *gin.Context) int {
	if state := compositePlatformFallbackStateFrom(c); state != nil {
		return state.switchCount
	}
	return 0
}

// requestCompositePlatformFallback 在当前平台选号耗尽时调用。若还有待尝试的
// 平台且尚未向客户端写出任何内容，记录下一个平台并返回 true；调用方应直接
// return（不写错误响应），由 runWithCompositePlatformFallback 换平台重跑。
func requestCompositePlatformFallback(c *gin.Context, switchCount int) bool {
	state := compositePlatformFallbackStateFrom(c)
	if state == nil || len(state.remaining) == 0 {
		return false
	}
	if c.Writer.Written() || c.IsAborted() || failoverClientGone(c) {
		return false
	}
	state.next = state.remaining[0]
	state.remaining = state.remaining[1:]
	state.switchCount = switchCount
	return true
}
