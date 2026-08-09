package service

import (
	"context"
	"strconv"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
)

func (s *OpsService) GetAccountHourlyFailures(ctx context.Context, accountIDs []int64) (*OpsAccountHourlyFailureResponse, error) {
	if err := s.RequireMonitoringEnabled(ctx); err != nil {
		return nil, err
	}
	if len(accountIDs) == 0 {
		return nil, infraerrors.BadRequest("OPS_ACCOUNT_IDS_REQUIRED", "account_ids is required")
	}
	if s.opsRepo == nil {
		return nil, infraerrors.ServiceUnavailable("OPS_REPO_UNAVAILABLE", "Ops repository not available")
	}

	startTime := timezone.Today()
	endTime := startTime.AddDate(0, 0, 1)
	buckets, err := s.opsRepo.GetAccountHourlyFailureBuckets(ctx, accountIDs, startTime, endTime, timezone.Name())
	if err != nil {
		return nil, infraerrors.InternalServer("OPS_ACCOUNT_FAILURE_QUERY_FAILED", "Failed to query account failure rates").WithCause(err)
	}

	byAccount := make(map[string][]*OpsAccountHourlyFailureBucket, len(accountIDs))
	for _, accountID := range accountIDs {
		key := strconv.FormatInt(accountID, 10)
		byAccount[key] = make([]*OpsAccountHourlyFailureBucket, 24)
		for hour := 0; hour < 24; hour++ {
			byAccount[key][hour] = &OpsAccountHourlyFailureBucket{AccountID: accountID, Hour: hour}
		}
	}
	for _, bucket := range buckets {
		if bucket == nil || bucket.Hour < 0 || bucket.Hour > 23 {
			continue
		}
		key := strconv.FormatInt(bucket.AccountID, 10)
		if hours, ok := byAccount[key]; ok {
			hours[bucket.Hour] = bucket
		}
	}

	return &OpsAccountHourlyFailureResponse{
		Date:      startTime.Format("2006-01-02"),
		Timezone:  timezone.Name(),
		ByAccount: byAccount,
	}, nil
}
