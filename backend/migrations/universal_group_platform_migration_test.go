package migrations

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// 全平台分组迁移：所有分组回填为 composite，并把列默认值改为 composite。
// 迁移必须是幂等的（只用 UPDATE ... WHERE platform IS DISTINCT FROM 与幂等 ALTER）。
func TestUniversalGroupPlatformMigration(t *testing.T) {
	content, err := FS.ReadFile("249_universal_group_platform.sql")
	require.NoError(t, err)

	sql := strings.Join(strings.Fields(string(content)), " ")

	require.Contains(t, sql, "UPDATE groups SET platform = 'composite'")
	require.Contains(t, sql, "WHERE platform IS DISTINCT FROM 'composite'",
		"回填必须跳过已是 composite 的行，保证可重复执行")
	require.Contains(t, sql, "ALTER TABLE groups ALTER COLUMN platform SET DEFAULT 'composite'")
	require.NotContains(t, strings.ToUpper(sql), "DROP COLUMN",
		"platform 列保留为形态标记，不删除")
}
