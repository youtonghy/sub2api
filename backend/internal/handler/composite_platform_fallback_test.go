package handler

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/tlsfingerprint"
	middleware "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newCompositeFallbackTestContext(t *testing.T, body string, fallback []string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	req = req.WithContext(service.WithCompositeRouteDecision(req.Context(), service.CompositeRouteDecision{
		Matched:           true,
		Source:            service.CompositeRouteSourceAccount,
		PublicModel:       "qwen4-max",
		TargetPlatform:    service.PlatformOpenAI,
		UpstreamModel:     "qwen4-max",
		FallbackPlatforms: fallback,
	}))
	c.Request = req
	return c, recorder
}

var compositeGroupAPIKey = &service.APIKey{Group: &service.Group{ID: 1, Platform: service.PlatformComposite}}

type compositeFallbackAttemptRecord struct {
	platform    string
	body        string
	switchCount int
}

// Scenario: 首选平台耗尽 → 换下一个平台重跑；每次尝试拿到原始 body 与新平台 ctx，切换次数累计
func TestRunWithCompositePlatformFallbackSwitchesPlatformWithFreshRequest(t *testing.T) {
	const original = `{"model":"qwen4-max","reasoning":{"effort":"high"}}`
	c, recorder := newCompositeFallbackTestContext(t, original, []string{service.PlatformOpenCodeGo, service.PlatformDeepseek})

	var attempts []compositeFallbackAttemptRecord
	runWithCompositePlatformFallback(c, "chat_completions", func(c *gin.Context) {
		platform, _ := service.ResolvedTargetPlatformFromContext(c.Request.Context())
		// 计费按 ctx 解析配额平台：必须跟随本次尝试的平台
		require.Equal(t, platform, service.QuotaPlatform(c.Request.Context(), compositeGroupAPIKey))
		body, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		attempts = append(attempts, compositeFallbackAttemptRecord{platform: platform, body: string(body), switchCount: compositeFallbackInitialSwitchCount(c)})
		// 模拟平台相关改写：后续尝试必须看不到它
		c.Request = c.Request.WithContext(service.WithResolvedTargetPlatform(c.Request.Context(), "polluted"))
		if len(attempts) < 3 {
			require.True(t, requestCompositePlatformFallback(c, len(attempts)*2))
			return
		}
		require.False(t, requestCompositePlatformFallback(c, 99), "no platforms left")
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	require.Equal(t, []compositeFallbackAttemptRecord{
		{platform: service.PlatformOpenAI, body: original, switchCount: 0},
		{platform: service.PlatformOpenCodeGo, body: original, switchCount: 2},
		{platform: service.PlatformDeepseek, body: original, switchCount: 4},
	}, attempts)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.Nil(t, compositePlatformFallbackStateFrom(c), "state must not leak past the request")

	// 计费读取的配额平台跟随最终平台之前的 ctx 切换
	platform, _ := service.ResolvedTargetPlatformFromContext(c.Request.Context())
	require.Equal(t, "polluted", platform)
}

// Scenario: 已向客户端写出内容后不再跨平台回退
func TestRunWithCompositePlatformFallbackStopsAfterResponseWritten(t *testing.T) {
	c, recorder := newCompositeFallbackTestContext(t, `{"model":"qwen4-max"}`, []string{service.PlatformOpenCodeGo})

	calls := 0
	runWithCompositePlatformFallback(c, "responses", func(c *gin.Context) {
		calls++
		c.Writer.WriteHeader(http.StatusOK)
		c.Writer.WriteHeaderNow()
		require.False(t, requestCompositePlatformFallback(c, 0))
		c.String(http.StatusServiceUnavailable, "no accounts")
	})
	require.Equal(t, 1, calls)
	require.Equal(t, http.StatusOK, recorder.Code)
}

// Scenario: 无回退序列（开关关闭 / 单平台归属）时只执行一次，回退请求被拒绝
func TestRunWithCompositePlatformFallbackWithoutSequenceRunsOnce(t *testing.T) {
	c, _ := newCompositeFallbackTestContext(t, `{"model":"qwen4-max"}`, nil)

	calls := 0
	runWithCompositePlatformFallback(c, "messages", func(c *gin.Context) {
		calls++
		require.False(t, requestCompositePlatformFallback(c, 3))
		require.Equal(t, 0, compositeFallbackInitialSwitchCount(c))
	})
	require.Equal(t, 1, calls)
}

// ---------------------------------------------------------------------------
// Handler-level: real Responses handler, composite group, openai → opencode_go
// ---------------------------------------------------------------------------

// compositeFallbackUpstream 在 strictFailoverUpstream 的按账号状态基础上，为走
// Chat Completions / Anthropic Messages 上游的 OpenAI 网关族平台（如 opencode_go
// 对 qwen 走 /messages）返回对应协议的 SSE 流。
type compositeFallbackUpstream struct {
	*strictFailoverUpstream
}

const compositeFallbackChatSSE = "data: {\"id\":\"chatcmpl-x\",\"object\":\"chat.completion.chunk\",\"model\":\"qwen4-max\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"from fallback platform\"},\"finish_reason\":null}]}\n\n" +
	"data: {\"id\":\"chatcmpl-x\",\"object\":\"chat.completion.chunk\",\"model\":\"qwen4-max\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}\n\n" +
	"data: [DONE]\n\n"

const compositeFallbackAnthropicSSE = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_x\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"qwen4-max\",\"content\":[],\"stop_reason\":null,\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n" +
	"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n" +
	"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"from fallback platform\"}}\n\n" +
	"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n" +
	"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}\n\n" +
	"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"

func (u compositeFallbackUpstream) Do(req *http.Request, proxy string, accountID int64, concurrency int) (*http.Response, error) {
	return u.route(req, accountID)
}

func (u compositeFallbackUpstream) DoWithTLS(req *http.Request, _ string, accountID int64, _ int, _ *tlsfingerprint.Profile) (*http.Response, error) {
	return u.route(req, accountID)
}

func (u compositeFallbackUpstream) route(req *http.Request, accountID int64) (*http.Response, error) {
	resp, err := u.handle(req, accountID)
	if err != nil || resp.StatusCode >= 400 {
		return resp, err
	}
	var stream string
	switch {
	case strings.Contains(req.URL.Path, "/chat/completions"):
		stream = compositeFallbackChatSSE
	case strings.HasSuffix(req.URL.Path, "/messages"):
		stream = compositeFallbackAnthropicSSE
	default:
		return resp, nil
	}
	_ = resp.Body.Close()
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       io.NopCloser(strings.NewReader(stream)),
	}, nil
}

func newCompositeFallbackResponsesRouter(t *testing.T, upstream *strictFailoverUpstream, accounts []service.Account, fallback []string) (*gin.Engine, func()) {
	t.Helper()
	cfg := &config.Config{RunMode: config.RunModeSimple}
	cfg.Gateway.MaxAccountSwitches = 3
	cfg.Gateway.Scheduling.LoadBatchEnabled = true
	groupID := int64(9910)
	repo := strictFailoverOpenAIAccountRepo{accounts: accounts}
	billingCache := service.NewBillingCacheService(nil, nil, nil, nil, nil, nil, cfg, nil)
	gateway := service.NewOpenAIGatewayService(
		repo, nil, nil, nil, nil, nil, &strictFailoverGatewayCache{}, cfg, nil,
		service.NewConcurrencyService(strictConcurrencyCache()),
		service.NewBillingService(cfg, nil), &service.RateLimitService{}, billingCache, compositeFallbackUpstream{upstream},
		&service.DeferredService{}, nil, nil, nil, nil, nil, nil, nil,
	)
	handler := NewOpenAIGatewayHandler(gateway, service.NewConcurrencyService(strictConcurrencyCache()), billingCache, &service.APIKeyService{}, nil, nil, nil, nil, cfg)
	apiKey := &service.APIKey{
		ID: 9911, GroupID: &groupID,
		User:  &service.User{ID: 9912, Status: service.StatusActive, Concurrency: 1},
		Group: &service.Group{ID: groupID, Platform: service.PlatformComposite, Status: service.StatusActive},
	}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyAPIKey), apiKey)
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: apiKey.User.ID, Concurrency: 1})
		// 等同 compositeTargetPlatformMiddleware 在开关开启时注入的解析结果
		c.Request = c.Request.WithContext(service.WithCompositeRouteDecision(c.Request.Context(), service.CompositeRouteDecision{
			Matched:           true,
			Source:            service.CompositeRouteSourceAccount,
			GroupID:           groupID,
			PublicModel:       "qwen4-max",
			TargetPlatform:    service.PlatformOpenAI,
			UpstreamModel:     "qwen4-max",
			FallbackPlatforms: fallback,
		}))
		c.Next()
	})
	router.POST("/openai/v1/responses", handler.Responses)
	return router, billingCache.Stop
}

func compositeFallbackAccounts() []service.Account {
	mapping := map[string]any{"qwen4-max": "qwen4-max"}
	return []service.Account{
		{
			ID: 31, Name: "bailian", Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey,
			Status: service.StatusActive, Schedulable: true, Concurrency: 1, Priority: 1,
			Credentials: map[string]any{"api_key": "sk-31", "base_url": "https://bailian.example/v1", "model_mapping": mapping},
		},
		{
			ID: 41, Name: "opencode-go", Platform: service.PlatformOpenCodeGo, Type: service.AccountTypeAPIKey,
			Status: service.StatusActive, Schedulable: true, Concurrency: 1, Priority: 2,
			Credentials: map[string]any{"api_key": "sk-41", "base_url": "https://opencode.example/v1", "model_mapping": mapping},
		},
	}
}

func serveCompositeFallbackResponses(router *gin.Engine, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/openai/v1/responses", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, req)
	return recorder
}

// Scenario: 首选平台账号上游 500 → 同一请求改由回退平台账号完成
func TestCompositeCrossPlatformFallback_Responses_UpstreamFailureFallsBackToNextPlatform(t *testing.T) {
	upstream := &strictFailoverUpstream{accountStatus: map[int64]int{31: http.StatusInternalServerError}}
	router, cleanup := newCompositeFallbackResponsesRouter(t, upstream, compositeFallbackAccounts(), []string{service.PlatformOpenCodeGo})
	defer cleanup()

	recorder := serveCompositeFallbackResponses(router, `{"model":"qwen4-max","input":"hello","stream":false}`)

	require.Equal(t, []int64{31, 41}, upstream.accountHits(), recorder.Body.String())
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "from fallback platform")
}

// Scenario: 首选平台没有可用账号 → 直接改用回退平台
func TestCompositeCrossPlatformFallback_Responses_NoAccountOnPreferredPlatform(t *testing.T) {
	accounts := compositeFallbackAccounts()
	accounts[0].Schedulable = false
	upstream := &strictFailoverUpstream{}
	router, cleanup := newCompositeFallbackResponsesRouter(t, upstream, accounts, []string{service.PlatformOpenCodeGo})
	defer cleanup()

	recorder := serveCompositeFallbackResponses(router, `{"model":"qwen4-max","input":"hello","stream":false}`)

	require.Equal(t, []int64{41}, upstream.accountHits(), recorder.Body.String())
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "from fallback platform")
}

// Scenario: 没有回退序列（开关关闭）时行为不变：首选平台失败即报错
func TestCompositeCrossPlatformFallback_Responses_DisabledKeepsSinglePlatform(t *testing.T) {
	upstream := &strictFailoverUpstream{accountStatus: map[int64]int{31: http.StatusInternalServerError}}
	router, cleanup := newCompositeFallbackResponsesRouter(t, upstream, compositeFallbackAccounts(), nil)
	defer cleanup()

	recorder := serveCompositeFallbackResponses(router, `{"model":"qwen4-max","input":"hello","stream":false}`)

	require.Equal(t, []int64{31}, upstream.accountHits())
	require.NotEqual(t, http.StatusOK, recorder.Code)
}

// Scenario: 带 previous_response_id 的续链请求不跨平台
func TestCompositeCrossPlatformFallback_Responses_PreviousResponseIDStaysOnPreferredPlatform(t *testing.T) {
	accounts := compositeFallbackAccounts()
	accounts[0].Schedulable = false
	upstream := &strictFailoverUpstream{}
	router, cleanup := newCompositeFallbackResponsesRouter(t, upstream, accounts, []string{service.PlatformOpenCodeGo})
	defer cleanup()

	recorder := serveCompositeFallbackResponses(router, `{"model":"qwen4-max","input":"hello","stream":false,"previous_response_id":"resp_abc"}`)

	require.Empty(t, upstream.accountHits())
	require.NotEqual(t, http.StatusOK, recorder.Code)
}
