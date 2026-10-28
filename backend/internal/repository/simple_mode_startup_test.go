package repository

import (
	"context"
	"errors"
	"testing"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

func TestEnsureSimpleModeStartup(t *testing.T) {
	for _, tt := range []struct {
		name string
		mode string
		seed bool
	}{
		{"simple enabled", config.RunModeSimple, true},
		{"simple disabled preserves admin setup", config.RunModeSimple, false},
		{"standard enabled", config.RunModeStandard, true},
		{"standard disabled", config.RunModeStandard, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			client := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.Postgres, db)))
			t.Cleanup(func() { _ = client.Close() })
			if tt.mode == config.RunModeSimple {
				if tt.seed {
					// The first seeding operation backfills auto-created Grok groups.
					mock.ExpectExec(`UPDATE "groups"`).WillReturnResult(sqlmock.NewResult(0, 0))
					// 全平台分组改造后只确保存在单个 `default` 分组：一次按名称的
					// 存在性检查，返回一行即视为已存在，不再按平台逐个 COUNT / 查询。
					mock.ExpectQuery(`SELECT "groups"\."id" FROM "groups"`).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
				}
				mock.ExpectQuery(`SELECT .*FROM "settings"`).
					WithArgs(simpleModeAdminConcurrencyUpgradeKey).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
			}
			cfg := &config.Config{RunMode: tt.mode, SimpleMode: config.SimpleModeConfig{AutoCreateDefaultGroups: tt.seed}}
			require.NoError(t, ensureSimpleModeStartup(context.Background(), client, cfg))
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestEnsureSimpleModeStartupSeedingFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	client := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.Postgres, db)))
	t.Cleanup(func() { _ = client.Close() })
	seedErr := errors.New("group seeding failed")
	mock.ExpectExec(`UPDATE "groups"`).WillReturnError(seedErr)
	cfg := &config.Config{RunMode: config.RunModeSimple, SimpleMode: config.SimpleModeConfig{AutoCreateDefaultGroups: true}}
	// No admin setup query is expected after a seeding failure.
	require.ErrorIs(t, ensureSimpleModeStartup(context.Background(), client, cfg), seedErr)
	require.NoError(t, mock.ExpectationsWereMet())
}
