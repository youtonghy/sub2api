package repository

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
)

// priorityTestExecutor delegates to a real database handle (sqlmock) while
// recording the statements the repository builds.
type priorityTestExecutor struct {
	db       *sql.DB
	execs    []string
	execArgs [][]any
}

func (e *priorityTestExecutor) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	e.execs = append(e.execs, query)
	e.execArgs = append(e.execArgs, append([]any(nil), args...))
	return e.db.ExecContext(ctx, query, args...)
}

func (e *priorityTestExecutor) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return e.db.QueryContext(ctx, query, args...)
}

// TestUpdatePrioritiesQueryCastsCaseBranches pins the SQL shape PostgreSQL actually
// accepts for the drag-and-drop priority batch update.
//
// Regression: the first version emitted `SET priority = CASE id WHEN $1 THEN $2 END`
// with no ELSE branch. PostgreSQL could not infer a type for the CASE result, treated
// the parameter as text, and every drop failed with
//
//	pq: column "priority" is of type integer but expression is of type text
//
// which the UI surfaced as "Internal error". A CASE with an ELSE branch anchored to
// the target column plus an explicit ::int cast is what works.
func TestUpdatePrioritiesQueryCastsCaseBranches(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer func() { _ = db.Close() }()

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM accounts`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	// 真正的优先级写入语句
	mock.ExpectExec(`UPDATE accounts SET priority = CASE id`).
		WillReturnResult(sqlmock.NewResult(0, 2))
	// enqueueSchedulerOutbox 后续会写 outbox；这里不做断言，允许任意顺序。
	mock.MatchExpectationsInOrder(false)
	mock.ExpectExec(`.*`).WillReturnResult(sqlmock.NewResult(0, 1))

	exec := &priorityTestExecutor{db: db}
	repo := newAccountRepositoryWithSQL(nil, exec, nil)
	if err := repo.UpdatePriorities(context.Background(), []service.AccountPriorityUpdate{
		{ID: 11, Priority: 3},
		{ID: 22, Priority: 4},
	}); err != nil {
		t.Fatalf("UpdatePriorities: %v", err)
	}

	var updateQuery string
	for _, statement := range exec.execs {
		if strings.HasPrefix(normalizeSQLWhitespace(statement), "UPDATE accounts SET priority = CASE id") {
			updateQuery = normalizeSQLWhitespace(statement)
			break
		}
	}
	if updateQuery == "" {
		t.Fatalf("no priority UPDATE statement was executed; got: %v", exec.execs)
	}

	if !strings.Contains(updateQuery, "::int") {
		t.Fatalf("CASE branches must cast to ::int; got: %s", updateQuery)
	}
	if !strings.Contains(updateQuery, "ELSE priority END") {
		t.Fatalf("CASE must end with ELSE priority END so PostgreSQL can infer the type; got: %s", updateQuery)
	}
	if regexp.MustCompile(`THEN \$\d+ END`).MatchString(updateQuery) {
		t.Fatalf("CASE must not end right after a bare parameter branch; got: %s", updateQuery)
	}
}
