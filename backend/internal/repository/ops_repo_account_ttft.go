package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

func (r *opsRepository) GetAccountTTFTStats(ctx context.Context, filter *service.OpsAccountTTFTFilter) (*service.OpsAccountTTFTResponse, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("nil ops repository")
	}

	dashboardFilter := &service.OpsDashboardFilter{
		StartTime: filter.StartTime.UTC(),
		EndTime:   filter.EndTime.UTC(),
		Platform:  filter.Platform,
		GroupID:   filter.GroupID,
	}
	join, where, args, next := buildUsageWhere(dashboardFilter, dashboardFilter.StartTime, dashboardFilter.EndTime, 1)
	if join == "" {
		join = "LEFT JOIN accounts a ON a.id = ul.account_id"
	}
	where += " AND ul.account_id IS NOT NULL AND ul.first_token_ms IS NOT NULL"
	query := fmt.Sprintf(`
SELECT
  ul.account_id,
  COALESCE(NULLIF(a.name, ''), 'Provider ' || ul.account_id::text) AS account_name,
  COALESCE(a.platform, '') AS platform,
  ROUND(AVG(ul.first_token_ms)::numeric, 2)::float8 AS avg_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY ul.first_token_ms)::float8 AS p95_ms,
  MAX(ul.first_token_ms)::bigint AS max_ms,
  COUNT(*)::bigint AS sample_count
FROM usage_logs ul
%s
%s
GROUP BY ul.account_id, a.name, a.platform
ORDER BY avg_ms DESC, sample_count DESC, ul.account_id ASC
LIMIT $%d`, join, where, next)
	args = append(args, filter.Limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	items := make([]*service.OpsAccountTTFTItem, 0, filter.Limit)
	for rows.Next() {
		item := &service.OpsAccountTTFTItem{}
		var avg, p95 sql.NullFloat64
		if err := rows.Scan(&item.AccountID, &item.AccountName, &item.Platform, &avg, &p95, &item.MaxMs, &item.SampleCount); err != nil {
			return nil, err
		}
		if avg.Valid {
			item.AvgMs = avg.Float64
		}
		if p95.Valid {
			item.P95Ms = p95.Float64
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &service.OpsAccountTTFTResponse{StartTime: dashboardFilter.StartTime, EndTime: dashboardFilter.EndTime, Items: items}, nil
}
