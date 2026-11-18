package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

type fallbackSettingRepoStub struct {
	SettingRepository
	values        map[string]string
	err           error
	getValueCalls int
}

func (s *fallbackSettingRepoStub) GetValue(_ context.Context, key string) (string, error) {
	s.getValueCalls++
	if s.err != nil {
		return "", s.err
	}
	if v, ok := s.values[key]; ok {
		return v, nil
	}
	return "", ErrSettingNotFound
}

func newFallbackTestResolver(ownership CompositeModelOwnership, enabled bool) *CompositeRouteResolver {
	resolver := NewCompositeRouteResolver(nil)
	resolver.SetModelOwnershipResolver(func(context.Context, int64, string) (CompositeModelOwnership, error) {
		return ownership, nil
	})
	resolver.SetCrossPlatformFallbackEnabled(func(context.Context) bool { return enabled })
	return resolver
}

// Scenario: 开关开启时，多个 OpenAI 网关族平台认领同一模型 → 按优先级顺序解析首选平台并携带回退序列
func TestCompositeRouteResolverCrossPlatformFallbackOrdersPlatforms(t *testing.T) {
	resolver := newFallbackTestResolver(CompositeModelOwnership{
		Ambiguous: true,
		Platforms: []string{PlatformOpenAI, PlatformOpenCodeGo, PlatformDeepseek},
	}, true)

	for _, endpoint := range []string{
		CompositeRouteEndpointChatCompletions,
		CompositeRouteEndpointResponses,
		CompositeRouteEndpointMessages,
	} {
		decision, err := resolver.Resolve(context.Background(), 7, "qwen4-max", endpoint)
		require.NoError(t, err)
		require.True(t, decision.Matched, "endpoint=%s", endpoint)
		require.Equal(t, CompositeRouteSourceAccount, decision.Source)
		require.Equal(t, PlatformOpenAI, decision.TargetPlatform)
		require.Equal(t, "qwen4-max", decision.UpstreamModel)
		require.Equal(t, []string{PlatformOpenCodeGo, PlatformDeepseek}, decision.FallbackPlatforms)
	}
}

// Scenario: 开关关闭时歧义模型保持原有不解析行为
func TestCompositeRouteResolverCrossPlatformFallbackDisabledKeepsAmbiguity(t *testing.T) {
	resolver := newFallbackTestResolver(CompositeModelOwnership{
		Ambiguous: true,
		Platforms: []string{PlatformOpenAI, PlatformOpenCodeGo},
	}, false)

	decision, err := resolver.Resolve(context.Background(), 7, "qwen4-max", CompositeRouteEndpointChatCompletions)
	require.NoError(t, err)
	require.False(t, decision.Matched)
	require.Empty(t, decision.FallbackPlatforms)
	require.Equal(t, CompositeRouteReasonAmbiguous, decision.Reason)

	// 未注入开关读取函数等同关闭
	unwired := NewCompositeRouteResolver(nil)
	unwired.SetModelOwnershipResolver(func(context.Context, int64, string) (CompositeModelOwnership, error) {
		return CompositeModelOwnership{Ambiguous: true, Platforms: []string{PlatformOpenAI, PlatformOpenCodeGo}}, nil
	})
	decision, err = unwired.Resolve(context.Background(), 7, "qwen4-max", CompositeRouteEndpointChatCompletions)
	require.NoError(t, err)
	require.False(t, decision.Matched)
}

// Scenario: 序列含 grok、非 OpenAI 网关族平台或请求来自 Gemini 原生端点时不启用回退
func TestCompositeRouteResolverCrossPlatformFallbackScope(t *testing.T) {
	cases := []struct {
		name      string
		platforms []string
		endpoint  string
	}{
		{"grok member", []string{PlatformOpenAI, PlatformGrok}, CompositeRouteEndpointChatCompletions},
		{"anthropic member", []string{PlatformOpenAI, PlatformAnthropic}, CompositeRouteEndpointMessages},
		{"gemini member", []string{PlatformGemini, PlatformOpenAI}, CompositeRouteEndpointChatCompletions},
		{"gemini endpoint", []string{PlatformOpenAI, PlatformOpenCodeGo}, CompositeRouteEndpointGemini},
		{"single platform list", []string{PlatformOpenAI}, CompositeRouteEndpointChatCompletions},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resolver := newFallbackTestResolver(CompositeModelOwnership{Ambiguous: true, Platforms: tc.platforms}, true)
			decision, err := resolver.Resolve(context.Background(), 7, "team-alias", tc.endpoint)
			require.NoError(t, err)
			require.False(t, decision.Matched)
			require.Empty(t, decision.FallbackPlatforms)
		})
	}
}

// Scenario: OAuth 歧义拒绝先于回退判断，开关开启也不改变
func TestCompositeRouteResolverCrossPlatformFallbackKeepsOAuthRejection(t *testing.T) {
	resolver := newFallbackTestResolver(CompositeModelOwnership{
		Ambiguous:                 true,
		OpenAIGatewayOAuthClaimed: true,
		Platforms:                 []string{PlatformOpenAI, PlatformOpenCodeGo},
	}, true)

	decision, err := resolver.Resolve(context.Background(), 7, "gpt-6-astra", CompositeRouteEndpointResponses)
	require.NoError(t, err)
	require.False(t, decision.Matched)
	require.True(t, decision.OAuthAmbiguous())
}

// Scenario: 显式路由优先于跨平台回退
func TestCompositeRouteResolverCrossPlatformFallbackExplicitRouteWins(t *testing.T) {
	resolver := NewCompositeRouteResolver(compositeRouteRepoStub{routes: []CompositeModelRoute{{
		GroupID: 7, PublicModel: "qwen4-max", MatchType: CompositeRouteMatchExact,
		TargetPlatform: PlatformOpenCodeGo, Enabled: true,
	}}})
	resolver.SetModelOwnershipResolver(func(context.Context, int64, string) (CompositeModelOwnership, error) {
		return CompositeModelOwnership{Ambiguous: true, Platforms: []string{PlatformOpenAI, PlatformOpenCodeGo}}, nil
	})
	resolver.SetCrossPlatformFallbackEnabled(func(context.Context) bool { return true })

	decision, err := resolver.Resolve(context.Background(), 7, "qwen4-max", CompositeRouteEndpointChatCompletions)
	require.NoError(t, err)
	require.True(t, decision.Matched)
	require.Equal(t, CompositeRouteSourceExplicit, decision.Source)
	require.Equal(t, PlatformOpenCodeGo, decision.TargetPlatform)
	require.Empty(t, decision.FallbackPlatforms)
}

// Scenario: 归属解析按仓储返回顺序（组内优先级 → 账号优先级）记录平台
func TestResolveCompositeModelOwnershipRecordsPlatformsInPriorityOrder(t *testing.T) {
	repo := &compositeOwnershipAccountRepo{accounts: []Account{
		{ID: 1, Platform: PlatformOpenAI, Credentials: map[string]any{"model_mapping": map[string]any{"qwen4-max": "qwen-max"}}},
		{ID: 2, Platform: PlatformOpenCodeGo, Credentials: map[string]any{"model_mapping": map[string]any{"qwen4-max": "qwen4-max"}}},
		{ID: 3, Platform: PlatformOpenAI, Credentials: map[string]any{"model_mapping": map[string]any{"qwen4-max": "qwen-max"}}},
	}}
	svc := &GatewayService{accountRepo: repo}

	ownership, err := svc.resolveCompositeModelOwnership(context.Background(), 7, "qwen4-max")
	require.NoError(t, err)
	require.True(t, ownership.Ambiguous)
	require.Equal(t, []string{PlatformOpenAI, PlatformOpenCodeGo}, ownership.Platforms)
}

func TestCompositeFallbackPlatformContextHelpers(t *testing.T) {
	ctx := WithCompositeRouteDecision(context.Background(), CompositeRouteDecision{
		Matched:           true,
		Source:            CompositeRouteSourceAccount,
		PublicModel:       "qwen4-max",
		TargetPlatform:    PlatformOpenAI,
		UpstreamModel:     "qwen4-max",
		FallbackPlatforms: []string{PlatformOpenCodeGo},
	})
	require.Equal(t, []string{PlatformOpenCodeGo}, CompositeFallbackPlatformsFromContext(ctx))

	switched := WithCompositeFallbackPlatform(ctx, PlatformOpenCodeGo)
	platform, ok := ResolvedTargetPlatformFromContext(switched)
	require.True(t, ok)
	require.Equal(t, PlatformOpenCodeGo, platform)
	require.Empty(t, CompositeFallbackPlatformsFromContext(switched))
	source, _ := CompositeRouteSourceFromContext(switched)
	require.Equal(t, CompositeRouteSourceAccount, source)
	public, _ := RequestedPublicModelFromContext(switched)
	require.Equal(t, "qwen4-max", public)

	// 原 ctx 不受影响
	original, _ := ResolvedTargetPlatformFromContext(ctx)
	require.Equal(t, PlatformOpenAI, original)
}

func TestSettingServiceCompositeCrossPlatformFallbackRuntimeValue(t *testing.T) {
	cfg := &config.Config{}
	cfg.Gateway.Scheduling.CrossPlatformFallback = true

	// 未保存过设置：沿用配置值
	repo := &fallbackSettingRepoStub{values: map[string]string{}}
	svc := NewSettingService(repo, cfg)
	require.True(t, svc.IsCompositeCrossPlatformFallbackEnabled(context.Background()))

	// 设置表中的值优先于配置，且命中缓存时不再读库
	repo2 := &fallbackSettingRepoStub{values: map[string]string{SettingKeyCompositeCrossPlatformFallback: "false"}}
	svc2 := NewSettingService(repo2, cfg)
	require.False(t, svc2.IsCompositeCrossPlatformFallbackEnabled(context.Background()))
	require.False(t, svc2.IsCompositeCrossPlatformFallbackEnabled(context.Background()))
	require.Equal(t, 1, repo2.getValueCalls)

	// 保存设置后立即生效
	svc2.storeCompositeCrossPlatformFallback(true)
	require.True(t, svc2.IsCompositeCrossPlatformFallbackEnabled(context.Background()))

	// 读库失败沿用配置值
	repo3 := &fallbackSettingRepoStub{err: errors.New("db down")}
	svc3 := NewSettingService(repo3, cfg)
	require.True(t, svc3.IsCompositeCrossPlatformFallbackEnabled(context.Background()))
}

func TestParseCompositeCrossPlatformFallbackSetting(t *testing.T) {
	require.True(t, parseCompositeCrossPlatformFallback("", true))
	require.False(t, parseCompositeCrossPlatformFallback("", false))
	require.True(t, parseCompositeCrossPlatformFallback(" TRUE ", false))
	require.False(t, parseCompositeCrossPlatformFallback("false", true))
}
