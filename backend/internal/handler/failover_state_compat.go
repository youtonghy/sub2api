package handler

// newFailoverState preserves the handler-level factory used by gateway paths
// while the failover state implementation remains package-owned.
func (h *GatewayHandler) newFailoverState(maxSwitches int, hasBoundSession bool) *FailoverState {
	return NewFailoverState(maxSwitches, hasBoundSession)
}
