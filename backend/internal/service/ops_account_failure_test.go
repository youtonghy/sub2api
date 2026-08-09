package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestOpsServiceGetAccountHourlyFailuresFillsAllHours(t *testing.T) {
	repo := &opsRepoMock{
		GetAccountHourlyFailureBucketsFn: func(_ context.Context, ids []int64, _, _ time.Time, _ string) ([]*OpsAccountHourlyFailureBucket, error) {
			require.Equal(t, []int64{7, 9}, ids)
			return []*OpsAccountHourlyFailureBucket{
				{AccountID: 7, Hour: 14, RequestCount: 10, FailureCount: 2, FailureRate: 0.2},
			}, nil
		},
	}
	svc := &OpsService{opsRepo: repo}

	result, err := svc.GetAccountHourlyFailures(context.Background(), []int64{7, 9})
	require.NoError(t, err)
	require.Len(t, result.ByAccount["7"], 24)
	require.Len(t, result.ByAccount["9"], 24)
	require.Equal(t, int64(10), result.ByAccount["7"][14].RequestCount)
	require.Equal(t, int64(0), result.ByAccount["7"][13].RequestCount)
}

func TestOpsServiceGetAccountHourlyFailuresRequiresIDs(t *testing.T) {
	svc := &OpsService{opsRepo: &opsRepoMock{}}
	_, err := svc.GetAccountHourlyFailures(context.Background(), nil)
	require.Error(t, err)
}
