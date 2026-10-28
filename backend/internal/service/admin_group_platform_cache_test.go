//go:build unit

package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// groupPlatformRepoStub 只实现 UpdateGroup 走到的两个方法，其余靠内嵌接口占位。
type groupPlatformRepoStub struct {
	GroupRepository
	group   *Group
	updated *Group
}

func (r *groupPlatformRepoStub) GetByID(_ context.Context, _ int64) (*Group, error) {
	cloned := *r.group
	return &cloned, nil
}

func (r *groupPlatformRepoStub) Update(_ context.Context, group *Group) error {
	r.updated = group
	return nil
}

type channelCacheInvalidatorSpy struct {
	calls int
}

func (s *channelCacheInvalidatorSpy) InvalidateCache() { s.calls++ }

// 渠道缓存持有 groupID → platform，而渠道定价/模型映射/模型白名单都按平台隔离。
// 全平台分组改造后 platform 恒为 composite：迁移前的单平台历史分组第一次被更新时
// 会被归一为 composite，该次归一必须失效渠道缓存；已经是 composite 的分组再更新
// 不再产生平台变化，因此不需要失效。
func TestUpdateGroupInvalidatesChannelCacheOnPlatformNormalization(t *testing.T) {
	tests := []struct {
		name          string
		fromPlatform  string
		inputPlatform string
		wantCalls     int
		wantPlatform  string
	}{
		{
			name:          "legacy concrete platform is normalized and invalidates",
			fromPlatform:  PlatformAnthropic,
			inputPlatform: PlatformOpenAI,
			wantCalls:     1,
			wantPlatform:  PlatformComposite,
		},
		{
			name:          "legacy concrete platform invalidates even without input platform",
			fromPlatform:  PlatformAnthropic,
			inputPlatform: "",
			wantCalls:     1,
			wantPlatform:  PlatformComposite,
		},
		{
			name:          "already universal group does not invalidate",
			fromPlatform:  PlatformComposite,
			inputPlatform: PlatformOpenAI,
			wantCalls:     0,
			wantPlatform:  PlatformComposite,
		},
		{
			name:          "already universal group with platform omitted does not invalidate",
			fromPlatform:  PlatformComposite,
			inputPlatform: "",
			wantCalls:     0,
			wantPlatform:  PlatformComposite,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &groupPlatformRepoStub{group: &Group{ID: 7, Name: "g", Platform: tt.fromPlatform}}
			spy := &channelCacheInvalidatorSpy{}
			svc := &adminServiceImpl{groupRepo: repo, channelCacheInvalidator: spy}

			got, err := svc.UpdateGroup(context.Background(), 7, &UpdateGroupInput{Platform: tt.inputPlatform})
			require.NoError(t, err)
			require.NotNil(t, got)
			require.Equal(t, tt.wantPlatform, got.Platform)
			require.Equal(t, tt.wantCalls, spy.calls)
		})
	}
}

// 分组平台恒为 composite：即使请求想把平台改回某个具体平台，落库值也不变。
func TestUpdateGroupWithoutChannelCacheInvalidator(t *testing.T) {
	repo := &groupPlatformRepoStub{group: &Group{ID: 7, Name: "g", Platform: PlatformComposite}}
	svc := &adminServiceImpl{groupRepo: repo}

	got, err := svc.UpdateGroup(context.Background(), 7, &UpdateGroupInput{Platform: PlatformOpenAI})
	require.NoError(t, err)
	require.Equal(t, PlatformComposite, got.Platform)
}
