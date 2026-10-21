package handler

import (
	"time"
)

// newFailoverState 构造 handler 层的 failover 状态，并注入严格优先级回退策略。
//
// 严格优先级开关、池模式重试次数与换号冷却时长都来自运营商配置
// （gateway.scheduling.strict_priority_*）。冷却时长只在配置为正数时覆盖默认
// 短冷却，0 表示保持默认行为，避免失败账号在切换后被立刻重新命中。
func (h *GatewayHandler) newFailoverState(maxSwitches int, hasBoundSession bool) *FailoverState {
	strictPriorityFallback := false
	strictPriorityRetries := 0
	var strictPriorityCooldown time.Duration
	if h != nil && h.cfg != nil {
		scheduling := h.cfg.Gateway.Scheduling
		strictPriorityFallback = scheduling.StrictPriorityFallback
		strictPriorityRetries = scheduling.StrictPriorityRetryCount
		if scheduling.StrictPriorityCooldownMinutes > 0 {
			strictPriorityCooldown = time.Duration(scheduling.StrictPriorityCooldownMinutes) * time.Minute
		}
	}
	state := NewFailoverStateWithStrictPriority(maxSwitches, hasBoundSession, strictPriorityFallback)
	if strictPriorityFallback && h.gatewayService != nil {
		state.SetStrictPriorityPolicy(
			strictPriorityRetries,
			strictPriorityCooldown,
			h.gatewayService.TempUnscheduleStrictPriorityFailure,
		)
	}
	return state
}
