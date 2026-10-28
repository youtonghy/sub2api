//go:build unit

package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// 全平台分组改造的核心不变量：
//   - 分组 platform 恒为 composite，客户端传入的具体平台被忽略。
//   - 单平台 sanitizer 不再清空分组级配置。
func TestNormalizeGroupPlatform_AlwaysUniversal(t *testing.T) {
	for _, input := range []string{"", "anthropic", "openai", "gemini", "bogus", PlatformComposite} {
		require.Equal(t, PlatformComposite, NormalizeGroupPlatform(input),
			"platform %q 必须归一为 composite", input)
	}
}

func TestProfitControlConfig_SupportedOnUniversalGroups(t *testing.T) {
	// 旧实现把 composite 排除在利润控制之外，导致保存分组时静默重置为关/0/0。
	enabled, margin, buffer := NormalizeProfitControlConfig(PlatformComposite, true, 0.3, 0.05)
	require.True(t, enabled)
	require.InDelta(t, 0.3, margin, 1e-9)
	require.InDelta(t, 0.05, buffer, 1e-9)
	require.NoError(t, ValidateProfitControlConfig(PlatformComposite, true, 0.3, 0.05))

	// 数值约束仍然生效。
	require.Error(t, ValidateProfitControlConfig(PlatformComposite, true, 0.7, 0.4))
	require.Error(t, ValidateProfitControlConfig(PlatformComposite, true, 1.0, 0))
}

func TestCodexModelsManifestConfig_SurvivesUniversalGroup(t *testing.T) {
	cfg := GroupCodexModelsManifestConfig{
		Enabled:             true,
		AccountIDs:          []int64{5, 3, 5, 0, -1},
		FallbackToScheduler: true,
	}
	out := normalizeCodexModelsManifestConfig(PlatformComposite, cfg)
	require.True(t, out.Enabled)
	require.True(t, out.FallbackToScheduler)
	require.Equal(t, []int64{5, 3}, out.AccountIDs, "去重保序并丢弃非法 ID")
}

func TestMessagesDispatchFieldsSurviveUniversalGroup(t *testing.T) {
	g := &Group{
		Platform:                    PlatformComposite,
		AllowMessagesDispatch:       true,
		DefaultMappedModel:          "gpt-5.4",
		MessagesDispatchModelConfig: OpenAIMessagesDispatchModelConfig{OpusMappedModel: "gpt-5.4", SonnetMappedModel: "gpt-5.3-codex"},
	}
	sanitizeGroupMessagesDispatchFields(g)
	require.True(t, g.AllowMessagesDispatch)
	require.Equal(t, "gpt-5.4", g.DefaultMappedModel)
	require.Equal(t, "gpt-5.4", g.MessagesDispatchModelConfig.OpusMappedModel)
	require.Equal(t, "gpt-5.3-codex", g.MessagesDispatchModelConfig.SonnetMappedModel)
}

func TestGroupAllowLiveSupportsUniversalGroup(t *testing.T) {
	require.True(t, supportsGroupAllowLive(PlatformComposite))
	require.True(t, supportsGroupAllowLive(PlatformOpenAI))
	require.False(t, supportsGroupAllowLive(PlatformAnthropic))
}

func TestDefaultAllowImageGenerationForUniversalGroup(t *testing.T) {
	require.True(t, DefaultAllowImageGenerationForPlatform(PlatformComposite),
		"全平台分组新建时应默认允许生图，与 gemini/grok/antigravity 一致")
}

func TestInvalidRequestFallbackSupportsUniversalGroup(t *testing.T) {
	require.True(t, supportsInvalidRequestFallback(PlatformComposite))
	require.True(t, supportsInvalidRequestFallback(PlatformAnthropic))
	require.False(t, supportsInvalidRequestFallback(PlatformOpenAI))
}

func TestIsGroupBindableInSimpleMode_AllowsUniversalGroup(t *testing.T) {
	require.True(t, IsGroupBindableInSimpleMode(&Group{ID: 1, Platform: PlatformComposite}))
	require.True(t, IsGroupBindableInSimpleMode(&Group{ID: 2, Platform: PlatformAnthropic}))
	require.False(t, IsGroupBindableInSimpleMode(nil))
}

// GroupNeedsPlatformResolution 决定 handler 是否要逐请求解析目标平台。全平台分组
// 必须解析；迁移残留的具体平台行仍走旧行为。
func TestGroupNeedsPlatformResolution(t *testing.T) {
	require.True(t, GroupNeedsPlatformResolution(&Group{Platform: PlatformComposite}))
	require.True(t, GroupNeedsPlatformResolution(&Group{Platform: ""}))
	require.True(t, GroupNeedsPlatformResolution(&Group{Platform: "unknown-platform"}))
	require.True(t, GroupNeedsPlatformResolution(nil))
	require.False(t, GroupNeedsPlatformResolution(&Group{Platform: PlatformAnthropic}))
	require.False(t, GroupNeedsPlatformResolution(&Group{Platform: PlatformOpenAI}))
}

// Gemini messages 兼容路径必须按解析出的目标平台选号：全平台分组不能再把
// "composite" 当成平台去匹配账号（那样只会选出 0 个账号）。
func TestGeminiMessagesCompatResolvesResolvedTargetPlatform(t *testing.T) {
	svc := &GeminiMessagesCompatService{}
	ctx := WithResolvedTargetPlatform(context.Background(), PlatformGemini)
	platform, mixed, forced, err := svc.resolvePlatformAndSchedulingMode(ctx, nil, "some-alias")
	require.NoError(t, err)
	require.Equal(t, PlatformGemini, platform)
	require.True(t, mixed)
	require.False(t, forced)

	// 解析到非 gemini 平台时不启用 gemini 混合调度。
	ctx = WithResolvedTargetPlatform(context.Background(), PlatformOpenAI)
	platform, mixed, _, err = svc.resolvePlatformAndSchedulingMode(ctx, nil, "some-alias")
	require.NoError(t, err)
	require.Equal(t, PlatformOpenAI, platform)
	require.False(t, mixed)
}

func TestGeminiMessagesCompatRejectsUnresolvableUniversalGroup(t *testing.T) {
	// 无 ctx 解析结果、模型名不可识别、分组是 composite -> 必须报错而不是静默返回 composite
	// 去匹配账号（那样只会选出 0 个账号并给出含糊的错误）。
	groupID := int64(11)
	repo := &mockGroupRepoForGemini{groups: map[int64]*Group{
		groupID: {ID: groupID, Platform: PlatformComposite},
	}}
	svc := &GeminiMessagesCompatService{
		groupRepo:   repo,
		accountRepo: &mockAccountRepoForGemini{accountsByID: map[int64]*Account{}},
		cache:       &mockGatewayCacheForGemini{},
	}
	_, _, _, err := svc.resolvePlatformAndSchedulingMode(context.Background(), &groupID, "totally-unknown-model")
	require.Error(t, err)

	// 模型名可识别时按模型解析。
	platform, mixed, _, err := svc.resolvePlatformAndSchedulingMode(context.Background(), &groupID, "claude-sonnet-4-5")
	require.NoError(t, err)
	require.Equal(t, PlatformAnthropic, platform)
	require.False(t, mixed)
}

func TestGeminiMessagesCompatNoGroupFallsBackToGemini(t *testing.T) {
	svc := &GeminiMessagesCompatService{}
	platform, mixed, forced, err := svc.resolvePlatformAndSchedulingMode(context.Background(), nil, "unknown-model")
	require.NoError(t, err)
	require.Equal(t, PlatformGemini, platform)
	require.True(t, mixed)
	require.False(t, forced)
}
