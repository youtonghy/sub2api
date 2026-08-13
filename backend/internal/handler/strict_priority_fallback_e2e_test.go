package handler

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/pkg/tlsfingerprint"
	middleware "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// Shared strict-priority fallback test fixtures (no production code touched)
// ---------------------------------------------------------------------------

// strictFailoverUpstream simulates per-account upstream behavior: HTTP status,
// SSE stream shape, or a transport-level error (connection refused).
type strictFailoverUpstream struct {
	mu   sync.Mutex
	hits []int64

	accountStatus          map[int64]int
	transportErr           map[int64]error
	streamMode             map[int64]string // "ok", "fail_first", "fail_after_event"
	streamBody             string
	anthropicNonStreamBody string
	openaiNonStreamBody    string
}

func (u *strictFailoverUpstream) Do(req *http.Request, _ string, accountID int64, _ int) (*http.Response, error) {
	return u.handle(req, accountID)
}

func (u *strictFailoverUpstream) DoWithTLS(req *http.Request, _ string, accountID int64, _ int, _ *tlsfingerprint.Profile) (*http.Response, error) {
	return u.handle(req, accountID)
}

func (u *strictFailoverUpstream) handle(req *http.Request, accountID int64) (*http.Response, error) {
	u.mu.Lock()
	u.hits = append(u.hits, accountID)
	status := u.accountStatus[accountID]
	transportErr := u.transportErr[accountID]
	streamMode := u.streamMode[accountID]
	u.mu.Unlock()

	if transportErr != nil {
		return nil, transportErr
	}
	if status >= 400 {
		return &http.Response{
			StatusCode: status,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"type":"error","error":{"type":"api_error","message":"upstream boom"}}`)),
		}, nil
	}

	if strings.Contains(req.URL.Path, "/responses") {
		// OpenAI Responses path.
		body := u.openaiNonStreamBody
		if body == "" {
			body = `{"id":"resp_strict_fallback","object":"response","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"from account 2"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(body)),
		}, nil
	}

	if streamMode != "" {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body:       io.NopCloser(newStrictSSEReader(u.streamBody, streamMode)),
		}, nil
	}
	body := u.anthropicNonStreamBody
	if body == "" {
		body = `{"id":"msg_2","type":"message","role":"assistant","content":[{"type":"text","text":"from account 2"}],"stop_reason":"end_turn","usage":{"input_tokens":2,"output_tokens":3}}`
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}, nil
}

func (u *strictFailoverUpstream) accountHits() []int64 {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]int64(nil), u.hits...)
}

// strictSSEReader emits a valid first SSE event (when configured) and then
// fails the stream, mirroring an upstream that breaks mid-stream.
type strictSSEReader struct {
	body      string
	mode      string
	sentEvent bool
	err       error
}

func newStrictSSEReader(body, mode string) *strictSSEReader {
	return &strictSSEReader{body: body, mode: mode, err: errors.New("stream read: connection reset")}
}

func (r *strictSSEReader) Read(p []byte) (int, error) {
	if r.mode == "fail_first" {
		return 0, r.err
	}
	if !r.sentEvent {
		r.sentEvent = true
		if r.body == "" {
			r.body = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"claude-sonnet-4-5\",\"usage\":{\"input_tokens\":1}}}\n\n"
		}
		return copy(p, r.body), nil
	}
	return 0, r.err
}

func (r *strictSSEReader) Close() error { return nil }

// strictFailoverOpenAIAccountRepo is a minimal AccountRepository for the OpenAI
// handler path (scheduler snapshot is nil; listing goes through the repo).
type strictFailoverOpenAIAccountRepo struct {
	service.AccountRepository
	accounts []service.Account
}

func (r strictFailoverOpenAIAccountRepo) ListSchedulableByPlatform(_ context.Context, platform string) ([]service.Account, error) {
	var out []service.Account
	for _, acc := range r.accounts {
		if acc.Platform == platform && acc.IsSchedulable() {
			out = append(out, acc)
		}
	}
	return out, nil
}

func (r strictFailoverOpenAIAccountRepo) ListSchedulableByGroupIDAndPlatform(_ context.Context, _ int64, platform string) ([]service.Account, error) {
	return r.ListSchedulableByPlatform(context.Background(), platform)
}

func (r strictFailoverOpenAIAccountRepo) ListSchedulableUngroupedByPlatform(ctx context.Context, platform string) ([]service.Account, error) {
	return r.ListSchedulableByPlatform(ctx, platform)
}

func (r strictFailoverOpenAIAccountRepo) GetByID(_ context.Context, id int64) (*service.Account, error) {
	for i := range r.accounts {
		if r.accounts[i].ID == id {
			acc := r.accounts[i]
			return &acc, nil
		}
	}
	return nil, nil
}

// strictFailoverSchedulerCache backs a SchedulerSnapshotService for the generic
// GatewayHandler path (Anthropic /v1/messages).
type strictFailoverSchedulerCache struct {
	accounts []*service.Account
}

func (c *strictFailoverSchedulerCache) GetSnapshot(_ context.Context, _ service.SchedulerBucket) ([]*service.Account, bool, error) {
	return c.accounts, true, nil
}
func (c *strictFailoverSchedulerCache) CaptureBucketWriteToken(_ context.Context, _ service.SchedulerBucket) (service.SchedulerBucketWriteToken, error) {
	return service.SchedulerBucketWriteToken{Bucket: service.SchedulerBucket{}, Epoch: 1}, nil
}
func (c *strictFailoverSchedulerCache) SetSnapshot(_ context.Context, _ service.SchedulerBucket, _ service.SchedulerBucketWriteToken, _ []service.Account) error {
	return nil
}
func (c *strictFailoverSchedulerCache) RetireBucket(_ context.Context, _ service.SchedulerBucket) error {
	return nil
}
func (c *strictFailoverSchedulerCache) ReopenBucket(_ context.Context, _ service.SchedulerBucket) (service.SchedulerBucketWriteToken, error) {
	return service.SchedulerBucketWriteToken{Bucket: service.SchedulerBucket{}, Epoch: 1}, nil
}
func (c *strictFailoverSchedulerCache) TryAcquireGroupLifecycleLease(_ context.Context, _ int64, _ time.Duration) (service.SchedulerGroupLifecycleLease, bool, error) {
	return service.SchedulerGroupLifecycleLease{}, false, nil
}
func (c *strictFailoverSchedulerCache) ReleaseGroupLifecycleLease(_ context.Context, _ service.SchedulerGroupLifecycleLease) error {
	return nil
}
func (c *strictFailoverSchedulerCache) GetAccount(_ context.Context, id int64) (*service.Account, error) {
	for _, acc := range c.accounts {
		if acc != nil && acc.ID == id {
			return acc, nil
		}
	}
	return nil, nil
}
func (c *strictFailoverSchedulerCache) SetAccount(_ context.Context, _ *service.Account) error {
	return nil
}
func (c *strictFailoverSchedulerCache) DeleteAccount(_ context.Context, _ int64) error { return nil }
func (c *strictFailoverSchedulerCache) UpdateLastUsed(_ context.Context, _ map[int64]time.Time) error {
	return nil
}
func (c *strictFailoverSchedulerCache) TryLockBucket(_ context.Context, _ service.SchedulerBucket, _ time.Duration) (bool, error) {
	return true, nil
}
func (c *strictFailoverSchedulerCache) UnlockBucket(_ context.Context, _ service.SchedulerBucket) error {
	return nil
}
func (c *strictFailoverSchedulerCache) ListBuckets(_ context.Context) ([]service.SchedulerBucket, error) {
	return nil, nil
}
func (c *strictFailoverSchedulerCache) GetOutboxWatermark(_ context.Context) (int64, error) {
	return 0, nil
}
func (c *strictFailoverSchedulerCache) SetOutboxWatermark(_ context.Context, _ int64) error {
	return nil
}

// strictFailoverGroupRepo is a minimal GroupRepository.
type strictFailoverGroupRepo struct {
	group *service.Group
}

func (r *strictFailoverGroupRepo) Create(context.Context, *service.Group) error { return nil }
func (r *strictFailoverGroupRepo) GetByID(context.Context, int64) (*service.Group, error) {
	return r.group, nil
}
func (r *strictFailoverGroupRepo) GetByIDLite(context.Context, int64) (*service.Group, error) {
	return r.group, nil
}
func (r *strictFailoverGroupRepo) Update(context.Context, *service.Group) error { return nil }
func (r *strictFailoverGroupRepo) Delete(context.Context, int64) error          { return nil }
func (r *strictFailoverGroupRepo) DeleteCascade(context.Context, int64) ([]int64, error) {
	return nil, nil
}
func (r *strictFailoverGroupRepo) List(context.Context, pagination.PaginationParams) ([]service.Group, *pagination.PaginationResult, error) {
	return nil, nil, nil
}
func (r *strictFailoverGroupRepo) ListWithFilters(context.Context, pagination.PaginationParams, string, string, string, *bool) ([]service.Group, *pagination.PaginationResult, error) {
	return nil, nil, nil
}
func (r *strictFailoverGroupRepo) ListActive(context.Context) ([]service.Group, error) {
	return nil, nil
}
func (r *strictFailoverGroupRepo) ListActiveByPlatform(context.Context, string) ([]service.Group, error) {
	return nil, nil
}
func (r *strictFailoverGroupRepo) ExistsByName(context.Context, string) (bool, error) {
	return false, nil
}
func (r *strictFailoverGroupRepo) GetAccountCount(context.Context, int64) (int64, int64, error) {
	return 0, 0, nil
}
func (r *strictFailoverGroupRepo) DeleteAccountGroupsByGroupID(context.Context, int64) (int64, error) {
	return 0, nil
}
func (r *strictFailoverGroupRepo) GetAccountIDsByGroupIDs(context.Context, []int64) ([]int64, error) {
	return nil, nil
}
func (r *strictFailoverGroupRepo) BindAccountsToGroup(context.Context, int64, []int64) error {
	return nil
}
func (r *strictFailoverGroupRepo) UpdateSortOrders(context.Context, []service.GroupSortOrderUpdate) error {
	return nil
}

// strictFailoverGatewayCache is a no-op GatewayCache (sticky disabled unless
// the test configures sessionBindings).
type strictFailoverGatewayCache struct {
	sessionBindings map[string]int64
}

func (c *strictFailoverGatewayCache) GetSessionAccountID(_ context.Context, _ int64, sessionHash string) (int64, error) {
	if c.sessionBindings != nil {
		if id, ok := c.sessionBindings[sessionHash]; ok {
			return id, nil
		}
	}
	return 0, errors.New("not found")
}
func (c *strictFailoverGatewayCache) SetSessionAccountID(_ context.Context, _ int64, sessionHash string, accountID int64, _ time.Duration) error {
	if c.sessionBindings == nil {
		c.sessionBindings = make(map[string]int64)
	}
	c.sessionBindings[sessionHash] = accountID
	return nil
}
func (c *strictFailoverGatewayCache) RefreshSessionTTL(context.Context, int64, string, time.Duration) error {
	return nil
}
func (c *strictFailoverGatewayCache) DeleteSessionAccountID(_ context.Context, _ int64, sessionHash string) error {
	if c.sessionBindings != nil {
		delete(c.sessionBindings, sessionHash)
	}
	return nil
}
func (c *strictFailoverGatewayCache) SetGrokVideoPendingBilling(context.Context, string, []byte, time.Duration) error {
	return nil
}
func (c *strictFailoverGatewayCache) GetGrokVideoPendingBilling(context.Context, string) ([]byte, error) {
	return nil, nil
}
func (c *strictFailoverGatewayCache) ClaimGrokVideoBilled(context.Context, string, time.Duration) (bool, error) {
	return true, nil
}
func (c *strictFailoverGatewayCache) ReleaseGrokVideoBilled(context.Context, string) error {
	return nil
}

// strictFailoverSimpleRepo backs the generic GatewayService with both listing
// and the mutation methods the failover loop may call (e.g. SetTempUnschedulable
// after an empty/retryable stream failure).
type strictFailoverSimpleRepo struct {
	service.AccountRepository
	accounts []*service.Account
}

func (r *strictFailoverSimpleRepo) ListSchedulableByPlatform(_ context.Context, platform string) ([]service.Account, error) {
	var out []service.Account
	for _, acc := range r.accounts {
		if acc != nil && acc.Platform == platform && acc.IsSchedulable() {
			out = append(out, *acc)
		}
	}
	return out, nil
}

func (r *strictFailoverSimpleRepo) ListSchedulableByGroupIDAndPlatform(_ context.Context, _ int64, platform string) ([]service.Account, error) {
	return r.ListSchedulableByPlatform(context.Background(), platform)
}

func (r *strictFailoverSimpleRepo) ListSchedulableUngroupedByPlatform(ctx context.Context, platform string) ([]service.Account, error) {
	return r.ListSchedulableByPlatform(ctx, platform)
}

func (r *strictFailoverSimpleRepo) GetByID(_ context.Context, id int64) (*service.Account, error) {
	for _, acc := range r.accounts {
		if acc != nil && acc.ID == id {
			return acc, nil
		}
	}
	return nil, nil
}

func (r *strictFailoverSimpleRepo) SetTempUnschedulable(_ context.Context, _ int64, _ time.Time, _ string) error {
	return nil
}

func (r *strictFailoverSimpleRepo) SetError(_ context.Context, _ int64, _ string) error { return nil }

func strictPriorityTestConfig() *config.Config {
	cfg := &config.Config{RunMode: config.RunModeSimple}
	cfg.Gateway.MaxAccountSwitches = 2
	cfg.Gateway.Scheduling.StrictPriorityFallback = true
	cfg.Gateway.Scheduling.LoadBatchEnabled = true
	return cfg
}

// strictConcurrencyCache grants both user and account slots so handler
// concurrency gates never block or fail the test requests.
func strictConcurrencyCache() *concurrencyCacheMock {
	return &concurrencyCacheMock{
		acquireUserSlotFn:    func(context.Context, int64, int, string) (bool, error) { return true, nil },
		acquireAccountSlotFn: func(context.Context, int64, int, string) (bool, error) { return true, nil },
	}
}

func strictAnthropicAccounts() []*service.Account {
	return []*service.Account{
		{
			ID: 1, Name: "p1", Platform: service.PlatformAnthropic, Type: service.AccountTypeAPIKey,
			Status: service.StatusActive, Schedulable: true, Concurrency: 1, Priority: 1,
			Credentials: map[string]any{"api_key": "sk-1", "base_url": "https://upstream-1.example"},
		},
		{
			ID: 2, Name: "p2", Platform: service.PlatformAnthropic, Type: service.AccountTypeAPIKey,
			Status: service.StatusActive, Schedulable: true, Concurrency: 1, Priority: 2,
			Credentials: map[string]any{"api_key": "sk-2", "base_url": "https://upstream-2.example"},
		},
	}
}

// newStrictGatewayMessagesHandler builds a GatewayHandler backed by a real
// GatewayService + scheduler snapshot + fake per-account upstream for the
// Anthropic /v1/messages path.
func newStrictGatewayMessagesHandler(t *testing.T, accounts []*service.Account, upstream *strictFailoverUpstream, cfg *config.Config, cache *strictFailoverGatewayCache) (*GatewayHandler, func()) {
	t.Helper()
	group := &service.Group{ID: 9901, Platform: service.PlatformAnthropic, Status: service.StatusActive, Hydrated: true}
	schedulerCache := &strictFailoverSchedulerCache{accounts: accounts}
	schedulerSnapshot := service.NewSchedulerSnapshotService(schedulerCache, nil, nil, nil, nil)
	if cache == nil {
		cache = &strictFailoverGatewayCache{}
	}
	gatewayService := service.NewGatewayService(
		&strictFailoverSimpleRepo{accounts: accounts}, // accountRepo (failover mutations)
		&strictFailoverGroupRepo{group: group},
		nil, nil, nil, nil, nil,
		cache,
		cfg,
		schedulerSnapshot,
		service.NewConcurrencyService(strictConcurrencyCache()),
		nil, // billingService
		&service.RateLimitService{},
		nil, // billingCacheService
		nil, // identityService
		upstream,
		&service.DeferredService{},
		nil, // claudeTokenProvider
		nil, // sessionLimitCache
		nil, // rpmCache
		nil, // digestStore
		nil, // settingService
		nil, // tlsFPProfileService
		nil, // channelService
		nil, // resolver
		nil, // compositeResolver
		nil, // balanceNotifyService
		nil, // userPlatformQuotaRepo
	)
	billingCacheSvc := service.NewBillingCacheService(nil, nil, nil, nil, nil, nil, cfg, nil)
	handler := &GatewayHandler{
		gatewayService:      gatewayService,
		billingCacheService: billingCacheSvc,
		concurrencyHelper:   NewConcurrencyHelper(service.NewConcurrencyService(strictConcurrencyCache()), SSEPingFormatClaude, 0),
		maxAccountSwitches:  cfg.Gateway.MaxAccountSwitches,
		cfg:                 cfg,
	}
	cleanup := func() { billingCacheSvc.Stop() }
	return handler, cleanup
}

// newStrictOpenAIResponsesHandler builds an OpenAIGatewayHandler for the
// /openai/v1/responses path.
func newStrictOpenAIResponsesHandler(t *testing.T, upstream *strictFailoverUpstream, cfg *config.Config) (*OpenAIGatewayHandler, *gin.Engine, func()) {
	t.Helper()
	groupID := int64(9902)
	accounts := []service.Account{
		{
			ID: 11, Name: "openai-p1", Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey,
			Status: service.StatusActive, Schedulable: true, Concurrency: 1, Priority: 1,
			Credentials: map[string]any{"api_key": "sk-11", "base_url": "https://openai-1.example/v1"},
		},
		{
			ID: 12, Name: "openai-p2", Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey,
			Status: service.StatusActive, Schedulable: true, Concurrency: 1, Priority: 2,
			Credentials: map[string]any{"api_key": "sk-12", "base_url": "https://openai-2.example/v1"},
		},
	}
	repo := strictFailoverOpenAIAccountRepo{accounts: accounts}
	billingCache := service.NewBillingCacheService(nil, nil, nil, nil, nil, nil, cfg, nil)
	gateway := service.NewOpenAIGatewayService(
		repo, nil, nil, nil, nil, nil, &strictFailoverGatewayCache{}, cfg, nil,
		service.NewConcurrencyService(strictConcurrencyCache()),
		service.NewBillingService(cfg, nil), &service.RateLimitService{}, billingCache, upstream,
		&service.DeferredService{}, nil, nil, nil, nil, nil, nil, nil,
	)
	handler := NewOpenAIGatewayHandler(gateway, service.NewConcurrencyService(strictConcurrencyCache()), billingCache, &service.APIKeyService{}, nil, nil, nil, nil, cfg)
	apiKey := &service.APIKey{
		ID: 9903, GroupID: &groupID,
		User:  &service.User{ID: 9904, Status: service.StatusActive, Concurrency: 1},
		Group: &service.Group{ID: groupID, Platform: service.PlatformOpenAI, Status: service.StatusActive},
	}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyAPIKey), apiKey)
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: apiKey.User.ID, Concurrency: 1})
		c.Next()
	})
	router.POST("/openai/v1/responses", handler.Responses)
	cleanup := func() { billingCache.Stop() }
	return handler, router, cleanup
}

// ---------------------------------------------------------------------------
// Scenario 1: handler-level OpenAI, strict mode, 500 -> 200
// ---------------------------------------------------------------------------

func TestStrictPriorityFallback_OpenAIResponses_500FallsBackToPriority2(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := strictPriorityTestConfig()
	upstream := &strictFailoverUpstream{accountStatus: map[int64]int{11: http.StatusInternalServerError}}
	h, router, cleanup := newStrictOpenAIResponsesHandler(t, upstream, cfg)
	defer cleanup()
	_ = h

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/openai/v1/responses", bytes.NewBufferString(`{"model":"gpt-5.1","input":"hello","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, req)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "resp_strict_fallback")
	require.Equal(t, []int64{11, 12}, upstream.accountHits(), "priority-1 500 must fail over to priority-2")
}

// ---------------------------------------------------------------------------
// Scenario 2: handler-level Anthropic Messages, strict mode, 500 -> 200
// ---------------------------------------------------------------------------

func TestStrictPriorityFallback_Messages_500FallsBackToPriority2(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := strictPriorityTestConfig()
	upstream := &strictFailoverUpstream{accountStatus: map[int64]int{1: http.StatusInternalServerError}}
	h, cleanup := newStrictGatewayMessagesHandler(t, strictAnthropicAccounts(), upstream, cfg, nil)
	defer cleanup()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewBufferString(`{"model":"claude-3-5-sonnet-20241022","max_tokens":64,"messages":[{"role":"user","content":"hello"}]}`))
	c.Request.Header.Set("Content-Type", "application/json")
	group := &service.Group{ID: 9901, Platform: service.PlatformAnthropic, Status: service.StatusActive, Hydrated: true}
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), ctxkey.Group, group))
	c.Set(string(middleware.ContextKeyAPIKey), &service.APIKey{
		ID: 9910, UserID: 9911, GroupID: &group.ID, Group: group, Status: service.StatusActive,
		User: &service.User{ID: 9911, Concurrency: 1, Balance: 100},
	})
	c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 9911, Concurrency: 1})

	h.Messages(c)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "from account 2")
	require.Equal(t, []int64{1, 2}, upstream.accountHits(), "priority-1 500 must fail over to priority-2")
	selected, ok := c.Get(opsAccountIDKey)
	require.True(t, ok)
	require.Equal(t, int64(2), selected)
}

// ---------------------------------------------------------------------------
// Scenario 3: handler-level transport error (connection refused) -> 200
// ---------------------------------------------------------------------------

func TestStrictPriorityFallback_Messages_TransportErrorFallsBackToPriority2(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := strictPriorityTestConfig()
	upstream := &strictFailoverUpstream{transportErr: map[int64]error{1: errors.New("dial tcp 10.255.255.1:443: connect: connection refused")}}
	h, cleanup := newStrictGatewayMessagesHandler(t, strictAnthropicAccounts(), upstream, cfg, nil)
	defer cleanup()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewBufferString(`{"model":"claude-3-5-sonnet-20241022","max_tokens":64,"messages":[{"role":"user","content":"hello"}]}`))
	c.Request.Header.Set("Content-Type", "application/json")
	group := &service.Group{ID: 9901, Platform: service.PlatformAnthropic, Status: service.StatusActive, Hydrated: true}
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), ctxkey.Group, group))
	c.Set(string(middleware.ContextKeyAPIKey), &service.APIKey{
		ID: 9912, UserID: 9913, GroupID: &group.ID, Group: group, Status: service.StatusActive,
		User: &service.User{ID: 9913, Concurrency: 1, Balance: 100},
	})
	c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 9913, Concurrency: 1})

	h.Messages(c)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "from account 2")
	require.Equal(t, []int64{1, 2}, upstream.accountHits(), "transport error on priority-1 must fail over to priority-2")
	selected, ok := c.Get(opsAccountIDKey)
	require.True(t, ok)
	require.Equal(t, int64(2), selected)
}

// ---------------------------------------------------------------------------
// Scenario 4: streaming — pre-first-byte failure falls back; post-event
// failure must not fall back.
// ---------------------------------------------------------------------------

func TestStrictPriorityFallback_Messages_StreamFailBeforeFirstByteFallsBack(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := strictPriorityTestConfig()
	upstream := &strictFailoverUpstream{
		streamMode: map[int64]string{1: "fail_first", 2: "ok"},
		streamBody: "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_2\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"claude-sonnet-4-5\",\"usage\":{\"input_tokens\":1}}}\n\n" +
			"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"from account 2\"}}\n\n" +
			"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":3}}\n\n" +
			"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
	}
	h, cleanup := newStrictGatewayMessagesHandler(t, strictAnthropicAccounts(), upstream, cfg, nil)
	defer cleanup()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewBufferString(`{"model":"claude-3-5-sonnet-20241022","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"hello"}]}`))
	c.Request.Header.Set("Content-Type", "application/json")
	group := &service.Group{ID: 9901, Platform: service.PlatformAnthropic, Status: service.StatusActive, Hydrated: true}
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), ctxkey.Group, group))
	c.Set(string(middleware.ContextKeyAPIKey), &service.APIKey{
		ID: 9914, UserID: 9915, GroupID: &group.ID, Group: group, Status: service.StatusActive,
		User: &service.User{ID: 9915, Concurrency: 1, Balance: 100},
	})
	c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 9915, Concurrency: 1})

	h.Messages(c)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "msg_2", "priority-2 stream must be delivered after pre-first-byte failover")
	require.Equal(t, []int64{1, 2}, upstream.accountHits())
}

func TestStrictPriorityFallback_Messages_StreamFailAfterEventDoesNotFallBack(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := strictPriorityTestConfig()
	upstream := &strictFailoverUpstream{streamMode: map[int64]string{1: "fail_after_event"}}
	h, cleanup := newStrictGatewayMessagesHandler(t, strictAnthropicAccounts(), upstream, cfg, nil)
	defer cleanup()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewBufferString(`{"model":"claude-3-5-sonnet-20241022","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"hello"}]}`))
	c.Request.Header.Set("Content-Type", "application/json")
	group := &service.Group{ID: 9901, Platform: service.PlatformAnthropic, Status: service.StatusActive, Hydrated: true}
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), ctxkey.Group, group))
	c.Set(string(middleware.ContextKeyAPIKey), &service.APIKey{
		ID: 9916, UserID: 9917, GroupID: &group.ID, Group: group, Status: service.StatusActive,
		User: &service.User{ID: 9917, Concurrency: 1, Balance: 100},
	})
	c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 9917, Concurrency: 1})

	h.Messages(c)

	require.Equal(t, []int64{1}, upstream.accountHits(), "once SSE content is committed, failover must not switch accounts")
	require.Contains(t, recorder.Body.String(), "msg_1", "committed first event must be preserved")
	require.Contains(t, recorder.Body.String(), `"type":"error"`, "stream must terminate with an SSE error event")
}

// ---------------------------------------------------------------------------
// Scenario 5: all providers fail — no infinite loop, upstream error surfaced
// ---------------------------------------------------------------------------

func TestStrictPriorityFallback_Messages_AllProvidersFailTerminatesWithUpstreamError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := strictPriorityTestConfig()
	upstream := &strictFailoverUpstream{accountStatus: map[int64]int{1: http.StatusInternalServerError, 2: http.StatusServiceUnavailable}}
	h, cleanup := newStrictGatewayMessagesHandler(t, strictAnthropicAccounts(), upstream, cfg, nil)
	defer cleanup()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewBufferString(`{"model":"claude-3-5-sonnet-20241022","max_tokens":64,"messages":[{"role":"user","content":"hello"}]}`))
	c.Request.Header.Set("Content-Type", "application/json")
	group := &service.Group{ID: 9901, Platform: service.PlatformAnthropic, Status: service.StatusActive, Hydrated: true}
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), ctxkey.Group, group))
	c.Set(string(middleware.ContextKeyAPIKey), &service.APIKey{
		ID: 9918, UserID: 9919, GroupID: &group.ID, Group: group, Status: service.StatusActive,
		User: &service.User{ID: 9919, Concurrency: 1, Balance: 100},
	})
	c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 9919, Concurrency: 1})

	h.Messages(c)

	require.Equal(t, []int64{1, 2}, upstream.accountHits(), "each account must be tried exactly once")
	require.Equal(t, http.StatusBadGateway, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "upstream", "response must reflect the preserved upstream failure")
}

// ---------------------------------------------------------------------------
// Scenario 6: regression guard — non-strict mode keeps sticky/priority flow
// ---------------------------------------------------------------------------

func TestStrictPriorityFallback_Messages_NonStrictStickyWinsOverPriority(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := strictPriorityTestConfig()
	cfg.Gateway.Scheduling.StrictPriorityFallback = false // regression: sticky scheduling applies
	accounts := strictAnthropicAccounts()
	// Priority-1 has higher priority (lower number), but sticky session is bound to priority-2.
	accounts[0].Priority = 1
	accounts[1].Priority = 2
	// Pre-seed a sticky session binding to the LOWER priority account (account 2).
	// The session hash is derived from the metadata.user_id in the request body.
	sessionKey := "11111111-1111-1111-1111-111111111111"
	cache := &strictFailoverGatewayCache{
		sessionBindings: map[string]int64{sessionKey: 2},
	}
	upstream := &strictFailoverUpstream{}
	h, cleanup := newStrictGatewayMessagesHandler(t, accounts, upstream, cfg, cache)
	defer cleanup()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	body := `{"model":"claude-3-5-sonnet-20241022","max_tokens":64,"metadata":{"user_id":"user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_account_00000000-0000-0000-0000-000000000000_session_` + sessionKey + `"},"messages":[{"role":"user","content":"hello"}]}`
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	group := &service.Group{ID: 9901, Platform: service.PlatformAnthropic, Status: service.StatusActive, Hydrated: true}
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), ctxkey.Group, group))
	apiKey := &service.APIKey{
		ID: 9920, UserID: 9921, GroupID: &group.ID, Group: group, Status: service.StatusActive,
		User: &service.User{ID: 9921, Concurrency: 1, Balance: 100},
	}
	c.Set(string(middleware.ContextKeyAPIKey), apiKey)
	c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 9921, Concurrency: 1})

	h.Messages(c)

	// With strict disabled, sticky session binding must be honored: the LOWER priority
	// account (ID=2) must be selected over the higher-priority account (ID=1).
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	selected, ok := c.Get(opsAccountIDKey)
	require.True(t, ok, "handler must set the selected account id")
	require.Equal(t, int64(2), selected, "non-strict mode must honor sticky session binding (lower priority sticky wins)")
}

// ---------------------------------------------------------------------------
// Scenario 7: non-strict 503 backoff behavior
// ---------------------------------------------------------------------------

func TestStrictPriorityFallback_NonStrict503Backoff(t *testing.T) {
	fs := NewFailoverState(3, false)
	fs.LastFailoverErr = newTestFailoverErr(503, false, false)
	fs.FailedAccountIDs[100] = struct{}{}
	fs.SwitchCount = 1

	// First backoff: returns Continue, clears FailedAccountIDs.
	action := fs.HandleSelectionExhausted(context.Background())
	require.Equal(t, FailoverContinue, action)
	require.Empty(t, fs.FailedAccountIDs, "503 backoff must clear failed account IDs")
	require.Equal(t, 1, fs.consecutiveSelectionBackoffs)

	// Re-add exclusion for the next round.
	fs.FailedAccountIDs[100] = struct{}{}
	action = fs.HandleSelectionExhausted(context.Background())
	require.Equal(t, FailoverContinue, action)
	require.Equal(t, 2, fs.consecutiveSelectionBackoffs)

	fs.FailedAccountIDs[100] = struct{}{}
	action = fs.HandleSelectionExhausted(context.Background())
	require.Equal(t, FailoverContinue, action)
	require.Equal(t, 3, fs.consecutiveSelectionBackoffs)

	// 4th round: backoff cap reached → Exhausted.
	fs.FailedAccountIDs[100] = struct{}{}
	action = fs.HandleSelectionExhausted(context.Background())
	require.Equal(t, FailoverExhausted, action, "after 3 consecutive backoffs, 4th must return Exhausted")
	require.Equal(t, 3, fs.consecutiveSelectionBackoffs, "counter must not increment after cap")
}
