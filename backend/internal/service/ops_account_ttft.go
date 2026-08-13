package service

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type OpsAccountTTFTFilter struct {
	StartTime time.Time
	EndTime   time.Time
	Platform  string
	GroupID   *int64
	Limit     int
}

type OpsAccountTTFTItem struct {
	AccountID   int64   `json:"account_id"`
	AccountName string  `json:"account_name"`
	Platform    string  `json:"platform"`
	AvgMs       float64 `json:"avg_ms"`
	P95Ms       float64 `json:"p95_ms"`
	MaxMs       int64   `json:"max_ms"`
	SampleCount int64   `json:"sample_count"`
}

type OpsAccountTTFTResponse struct {
	StartTime time.Time             `json:"start_time"`
	EndTime   time.Time             `json:"end_time"`
	Items     []*OpsAccountTTFTItem `json:"items"`
}

func (s *OpsService) GetAccountTTFTStats(ctx context.Context, filter *OpsAccountTTFTFilter) (*OpsAccountTTFTResponse, error) {
	if s == nil || s.opsRepo == nil {
		return nil, fmt.Errorf("ops repository not available")
	}
	if filter == nil || filter.StartTime.IsZero() || filter.EndTime.IsZero() || !filter.StartTime.Before(filter.EndTime) {
		return nil, fmt.Errorf("invalid TTFT time window")
	}
	filter.Platform = strings.ToLower(strings.TrimSpace(filter.Platform))
	if filter.Limit <= 0 || filter.Limit > 100 {
		filter.Limit = 100
	}
	return s.opsRepo.GetAccountTTFTStats(ctx, filter)
}
