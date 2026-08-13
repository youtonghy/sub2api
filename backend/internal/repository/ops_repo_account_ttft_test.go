package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestOpsRepositoryGetAccountTTFTStats(t *testing.T) {
	db, mock := newSQLMock(t)
	repo := &opsRepository{db: db}
	start := time.Date(2026, 8, 12, 0, 0, 0, 0, time.UTC)
	end := start.Add(30 * time.Minute)
	groupID := int64(2)

	mock.ExpectQuery(`ul\.first_token_ms IS NOT NULL[\s\S]+ORDER BY avg_ms DESC, sample_count DESC[\s\S]+LIMIT \$5`).
		WithArgs(start, end, groupID, "openai", 100).
		WillReturnRows(sqlmock.NewRows([]string{"account_id", "account_name", "platform", "avg_ms", "p95_ms", "max_ms", "sample_count"}).
			AddRow(int64(9), "Slow account", "openai", 2500.5, 4100.0, int64(6000), int64(12)))

	resp, err := repo.GetAccountTTFTStats(context.Background(), &service.OpsAccountTTFTFilter{
		StartTime: start,
		EndTime:   end,
		Platform:  "openai",
		GroupID:   &groupID,
		Limit:     100,
	})
	require.NoError(t, err)
	require.Len(t, resp.Items, 1)
	require.Equal(t, int64(9), resp.Items[0].AccountID)
	require.InDelta(t, 2500.5, resp.Items[0].AvgMs, 0.001)
	require.InDelta(t, 4100, resp.Items[0].P95Ms, 0.001)
	require.NoError(t, mock.ExpectationsWereMet())
}
