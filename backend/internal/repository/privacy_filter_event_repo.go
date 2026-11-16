package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/lib/pq"
)

// privacyFilterEventRepository stores privacy filter records (raw SQL,
// append-only). Expired rows are removed by the usage_logs retention cleanup.
type privacyFilterEventRepository struct {
	db *sql.DB
}

// NewPrivacyFilterEventRepository creates the repository.
func NewPrivacyFilterEventRepository(db *sql.DB) service.PrivacyFilterEventRepository {
	return &privacyFilterEventRepository{db: db}
}

const (
	privacyFilterEventDefaultPageSize = 20
	privacyFilterEventMaxPageSize     = 200
)

func (r *privacyFilterEventRepository) BatchInsert(ctx context.Context, events []*service.PrivacyFilterEvent) (int64, error) {
	if r == nil || r.db == nil {
		return 0, fmt.Errorf("nil privacy filter event repository")
	}
	if len(events) == 0 {
		return 0, nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	stmt, err := tx.PrepareContext(ctx, pq.CopyIn(
		"privacy_filter_events",
		"created_at", "request_id", "user_id", "user_email", "api_key_id", "api_key_name",
		"group_id", "group_name", "endpoint", "protocol", "model", "action",
		"fields", "total_hits", "categories",
	))
	if err != nil {
		_ = tx.Rollback()
		return 0, err
	}

	var inserted int64
	for _, event := range events {
		if event == nil {
			continue
		}
		if _, err := stmt.ExecContext(ctx, privacyFilterEventInsertValues(event)...); err != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			return 0, err
		}
		inserted++
	}
	if _, err := stmt.ExecContext(ctx); err != nil {
		_ = stmt.Close()
		_ = tx.Rollback()
		return 0, err
	}
	if err := stmt.Close(); err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return inserted, nil
}

func privacyFilterEventInsertValues(event *service.PrivacyFilterEvent) []any {
	createdAt := event.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now()
	}
	categories := "{}"
	if len(event.Categories) > 0 {
		if encoded, err := json.Marshal(event.Categories); err == nil {
			categories = string(encoded)
		}
	}
	return []any{
		createdAt.UTC(),
		truncateString(event.RequestID, 128),
		nullInt64Ptr(event.UserID),
		truncateString(event.UserEmail, 255),
		nullInt64Ptr(event.APIKeyID),
		truncateString(event.APIKeyName, 255),
		nullInt64Ptr(event.GroupID),
		truncateString(event.GroupName, 255),
		truncateString(event.Endpoint, 255),
		truncateString(event.Protocol, 64),
		truncateString(event.Model, 255),
		truncateString(event.Action, 16),
		event.Fields,
		event.TotalHits,
		categories,
	}
}

func buildPrivacyFilterEventsWhere(filter *service.PrivacyFilterEventFilter) (string, []any) {
	clauses := []string{"1=1"}
	args := make([]any, 0, 10)
	add := func(clause string, value any) {
		args = append(args, value)
		clauses = append(clauses, strings.ReplaceAll(clause, "$?", "$"+itoa(len(args))))
	}

	if filter.StartTime != nil {
		add("e.created_at >= $?", filter.StartTime.UTC())
	}
	if filter.EndTime != nil {
		add("e.created_at < $?", filter.EndTime.UTC())
	}
	if filter.UserID != nil {
		add("e.user_id = $?", *filter.UserID)
	}
	if filter.APIKeyID != nil {
		add("e.api_key_id = $?", *filter.APIKeyID)
	}
	if filter.GroupID != nil {
		add("e.group_id = $?", *filter.GroupID)
	}
	if v := strings.TrimSpace(filter.Action); v != "" {
		add("e.action = $?", v)
	}
	if v := strings.TrimSpace(filter.Category); v != "" {
		add("e.categories ? $?", v)
	}
	if v := strings.TrimSpace(filter.RequestID); v != "" {
		add("e.request_id = $?", v)
	}
	if v := strings.TrimSpace(filter.Query); v != "" {
		add("(e.user_email ILIKE $? OR e.api_key_name ILIKE $? OR e.model ILIKE $?)", "%"+escapeLikePattern(v)+"%")
	}
	return "WHERE " + strings.Join(clauses, " AND "), args
}

func (r *privacyFilterEventRepository) List(ctx context.Context, filter *service.PrivacyFilterEventFilter) (*service.PrivacyFilterEventList, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("nil privacy filter event repository")
	}
	if filter == nil {
		filter = &service.PrivacyFilterEventFilter{}
	}
	page := max(filter.Page, 1)
	pageSize := filter.PageSize
	if pageSize <= 0 {
		pageSize = privacyFilterEventDefaultPageSize
	}
	pageSize = min(pageSize, privacyFilterEventMaxPageSize)

	where, args := buildPrivacyFilterEventsWhere(filter)
	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM privacy_filter_events e "+where, args...).Scan(&total); err != nil {
		return nil, err
	}

	query := `SELECT e.id, e.created_at, e.request_id, e.user_id, e.user_email, e.api_key_id, e.api_key_name,
  e.group_id, e.group_name, e.endpoint, e.protocol, e.model, e.action, e.fields, e.total_hits, e.categories::text
FROM privacy_filter_events e
` + where + `
ORDER BY e.created_at DESC, e.id DESC
LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	rows, err := r.db.QueryContext(ctx, query, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	items := make([]*service.PrivacyFilterEvent, 0, pageSize)
	for rows.Next() {
		item := &service.PrivacyFilterEvent{}
		var userID, apiKeyID, groupID sql.NullInt64
		var categories string
		if err := rows.Scan(
			&item.ID, &item.CreatedAt, &item.RequestID, &userID, &item.UserEmail, &apiKeyID, &item.APIKeyName,
			&groupID, &item.GroupName, &item.Endpoint, &item.Protocol, &item.Model, &item.Action,
			&item.Fields, &item.TotalHits, &categories,
		); err != nil {
			return nil, err
		}
		item.UserID = nullInt64Value(userID)
		item.APIKeyID = nullInt64Value(apiKeyID)
		item.GroupID = nullInt64Value(groupID)
		item.Categories = map[string]int{}
		if err := json.Unmarshal([]byte(categories), &item.Categories); err != nil {
			return nil, fmt.Errorf("decode privacy filter event %d categories: %w", item.ID, err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &service.PrivacyFilterEventList{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func nullInt64Value(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	value := v.Int64
	return &value
}
