//go:build integration

package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

func TestPrivacyFilterEventRepository_InsertListAndCleanup(t *testing.T) {
	ctx := context.Background()
	repo := NewPrivacyFilterEventRepository(integrationDB)
	marker := "pf-" + uuid.NewString()
	userA, userB := int64(910001), int64(910002)
	keyA := int64(920001)
	now := time.Now().UTC()

	_, err := repo.BatchInsert(ctx, []*service.PrivacyFilterEvent{
		{CreatedAt: now.Add(-time.Minute), RequestID: marker + "-a1", UserID: &userA, APIKeyID: &keyA, Model: "claude-x",
			Action: service.PrivacyFilterModeRedact, Categories: map[string]int{"credential": 2}, TotalHits: 2},
		{CreatedAt: now.Add(-2 * time.Minute), RequestID: marker + "-a2", UserID: &userA, Model: "gpt-x",
			Action: service.PrivacyFilterModeObserve, Categories: map[string]int{"email": 1}, TotalHits: 1},
		{CreatedAt: now.Add(-3 * time.Minute), RequestID: marker + "-b1", UserID: &userB,
			Action: service.PrivacyFilterEventActionFailed},
		{CreatedAt: now.AddDate(0, 0, -40), RequestID: marker + "-old", UserID: &userA,
			Action: service.PrivacyFilterModeRedact, Categories: map[string]int{"credential": 1}, TotalHits: 1},
	})
	require.NoError(t, err)

	list, err := repo.List(ctx, &service.PrivacyFilterEventFilter{UserID: &userA})
	require.NoError(t, err)
	require.EqualValues(t, 3, list.Total)
	require.Equal(t, marker+"-a1", list.Items[0].RequestID, "newest first")
	require.Equal(t, map[string]int{"credential": 2}, list.Items[0].Categories)
	require.Equal(t, keyA, *list.Items[0].APIKeyID)
	require.Nil(t, list.Items[1].APIKeyID)

	byCategory, err := repo.List(ctx, &service.PrivacyFilterEventFilter{UserID: &userA, Category: "credential"})
	require.NoError(t, err)
	require.EqualValues(t, 2, byCategory.Total)

	start := now.Add(-90 * time.Second)
	byTime, err := repo.List(ctx, &service.PrivacyFilterEventFilter{UserID: &userA, StartTime: &start})
	require.NoError(t, err)
	require.EqualValues(t, 1, byTime.Total)

	byQuery, err := repo.List(ctx, &service.PrivacyFilterEventFilter{Query: "gpt-x", RequestID: marker + "-a2"})
	require.NoError(t, err)
	require.EqualValues(t, 1, byQuery.Total)

	failed, err := repo.List(ctx, &service.PrivacyFilterEventFilter{UserID: &userB, Action: service.PrivacyFilterEventActionFailed})
	require.NoError(t, err)
	require.EqualValues(t, 1, failed.Total)
	require.Empty(t, failed.Items[0].Categories)

	cleanup := newDashboardAggregationRepositoryWithSQL(integrationDB)
	require.NoError(t, cleanup.CleanupPrivacyFilterEvents(ctx, now.AddDate(0, 0, -30)))
	afterCleanup, err := repo.List(ctx, &service.PrivacyFilterEventFilter{UserID: &userA})
	require.NoError(t, err)
	require.EqualValues(t, 2, afterCleanup.Total)
}
