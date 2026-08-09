package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestOpsRepositoryGetAccountHourlyFailureBuckets(t *testing.T) {
	db, mock := newSQLMock(t)
	repo := &opsRepository{db: db}
	start := time.Date(2026, 8, 7, 0, 0, 0, 0, time.FixedZone("AEST", 10*60*60))
	end := start.Add(24 * time.Hour)

	mock.ExpectQuery(`WITH successful AS`).
		WithArgs(sqlmock.AnyArg(), start, end, "Australia/Melbourne").
		WillReturnRows(sqlmock.NewRows([]string{"account_id", "hour", "request_count", "failure_count"}).
			AddRow(int64(12), 9, int64(20), int64(1)).
			AddRow(int64(12), 10, int64(4), int64(4)))

	buckets, err := repo.GetAccountHourlyFailureBuckets(
		context.Background(),
		[]int64{12},
		start,
		end,
		"Australia/Melbourne",
	)
	require.NoError(t, err)
	require.Len(t, buckets, 2)
	require.InDelta(t, 0.05, buckets[0].FailureRate, 0.0001)
	require.InDelta(t, 1.0, buckets[1].FailureRate, 0.0001)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestOpsRepositoryGetAccountHourlyFailureBucketsEmptyIDs(t *testing.T) {
	db, mock := newSQLMock(t)
	repo := &opsRepository{db: db}

	buckets, err := repo.GetAccountHourlyFailureBuckets(context.Background(), nil, time.Time{}, time.Time{}, "UTC")
	require.NoError(t, err)
	require.Empty(t, buckets)
	require.NoError(t, mock.ExpectationsWereMet())
}
