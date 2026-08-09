package handler

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestFailoverStateStrictPrioritySkipsSameAccountRetryAndSwitchCap(t *testing.T) {
	state := NewFailoverState(0, false)
	state.StrictPriorityFallback = true
	err := &service.UpstreamFailoverError{StatusCode: http.StatusBadGateway, RetryableOnSameAccount: true}

	action := state.HandleFailoverError(context.Background(), &mockTempUnscheduler{}, 7, service.PlatformOpenAI, 3, err)
	require.Equal(t, FailoverContinue, action)
	require.Contains(t, state.FailedAccountIDs, int64(7))
	require.Zero(t, state.SameAccountRetryCount[7])
}

func TestFailoverStateStrictPriorityRetriesThenCoolsProvider(t *testing.T) {
	state := NewFailoverState(0, false)
	state.StrictPriorityFallback = true
	cooldownCalls := 0
	state.SetStrictPriorityPolicy(2, 15*time.Minute, func(_ context.Context, accountID int64, _ *service.UpstreamFailoverError) {
		require.Equal(t, int64(7), accountID)
		cooldownCalls++
	})
	err := &service.UpstreamFailoverError{StatusCode: http.StatusServiceUnavailable, RetryableOnSameAccount: true}

	require.Equal(t, FailoverContinue, state.HandleFailoverError(context.Background(), &mockTempUnscheduler{}, 7, service.PlatformOpenAI, 3, err))
	require.Equal(t, FailoverContinue, state.HandleFailoverError(context.Background(), &mockTempUnscheduler{}, 7, service.PlatformOpenAI, 3, err))
	require.NotContains(t, state.FailedAccountIDs, int64(7))
	require.Zero(t, cooldownCalls)

	require.Equal(t, FailoverContinue, state.HandleFailoverError(context.Background(), &mockTempUnscheduler{}, 7, service.PlatformOpenAI, 3, err))
	require.Contains(t, state.FailedAccountIDs, int64(7))
	require.Equal(t, 1, cooldownCalls)
}
