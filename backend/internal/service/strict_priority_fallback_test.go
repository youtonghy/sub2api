package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

type strictGatewayTestRepo struct {
	stubOpenAIAccountRepo
}

func (r strictGatewayTestRepo) ListSchedulableByPlatform(ctx context.Context, platform string) ([]Account, error) {
	var result []Account
	for _, acc := range r.accounts {
		if acc.Platform == platform && acc.IsSchedulable() {
			result = append(result, acc)
		}
	}
	return result, nil
}

func (r strictGatewayTestRepo) ListSchedulableByGroupIDAndPlatform(ctx context.Context, groupID int64, platform string) ([]Account, error) {
	return r.ListSchedulableByPlatform(ctx, platform)
}

func (r strictGatewayTestRepo) ListSchedulableUngroupedByPlatform(ctx context.Context, platform string) ([]Account, error) {
	return r.ListSchedulableByPlatform(ctx, platform)
}

func (r strictGatewayTestRepo) ListSchedulableByPlatforms(ctx context.Context, platforms []string) ([]Account, error) {
	platformSet := make(map[string]struct{}, len(platforms))
	for _, platform := range platforms {
		platformSet[platform] = struct{}{}
	}
	var result []Account
	for _, acc := range r.accounts {
		if _, ok := platformSet[acc.Platform]; ok && acc.IsSchedulable() {
			result = append(result, acc)
		}
	}
	return result, nil
}

func (r strictGatewayTestRepo) ListSchedulableByGroupIDAndPlatforms(ctx context.Context, groupID int64, platforms []string) ([]Account, error) {
	return r.ListSchedulableByPlatforms(ctx, platforms)
}

func (r strictGatewayTestRepo) ListSchedulableUngroupedByPlatforms(ctx context.Context, platforms []string) ([]Account, error) {
	return r.ListSchedulableByPlatforms(ctx, platforms)
}

type strictSessionLimitCache struct {
	SessionLimitCache
	denyAccountIDs map[int64]struct{}
}

func (c strictSessionLimitCache) RegisterSession(_ context.Context, accountID int64, _ string, _ int, _ time.Duration) (bool, error) {
	if c.denyAccountIDs == nil {
		return true, nil
	}
	if _, denied := c.denyAccountIDs[accountID]; denied {
		return false, nil
	}
	return true, nil
}

type strictGroupTestRepo struct {
	GroupRepository
	groups map[int64]*Group
}

func (r strictGroupTestRepo) GetByID(ctx context.Context, id int64) (*Group, error) {
	if group, ok := r.groups[id]; ok {
		return group, nil
	}
	return nil, ErrGroupNotFound
}

func (r strictGroupTestRepo) GetByIDLite(ctx context.Context, id int64) (*Group, error) {
	return r.GetByID(ctx, id)
}

func strictGatewayTestConfig() *config.Config {
	cfg := &config.Config{RunMode: config.RunModeStandard}
	cfg.Gateway.Scheduling.StrictPriorityFallback = true
	cfg.Gateway.Scheduling.LoadBatchEnabled = true
	return cfg
}

func strictRateMultiplier(v float64) *float64 { return &v }

func strictOpenAITestConfig() *config.Config {
	cfg := &config.Config{}
	cfg.Gateway.Scheduling.StrictPriorityFallback = true
	cfg.Gateway.Scheduling.LoadBatchEnabled = true
	return cfg
}

func TestGatewayService_StrictPriorityFallback_SelectsNextPriorityWhenHighestExcluded(t *testing.T) {
	repo := strictGatewayTestRepo{stubOpenAIAccountRepo: stubOpenAIAccountRepo{accounts: []Account{
		{ID: 1, Platform: PlatformAnthropic, Type: AccountTypeAPIKey, Priority: 1, Status: StatusActive, Schedulable: true, Concurrency: 1},
		{ID: 2, Platform: PlatformAnthropic, Type: AccountTypeAPIKey, Priority: 2, Status: StatusActive, Schedulable: true, Concurrency: 1},
	}}}
	cache := &stubGatewayCache{sessionBindings: map[string]int64{"sess": 1}}
	svc := &GatewayService{
		accountRepo:        repo,
		cache:              cache,
		cfg:                strictGatewayTestConfig(),
		concurrencyService: NewConcurrencyService(stubConcurrencyCache{}),
	}

	selection, err := svc.SelectAccountWithLoadAwareness(context.Background(), nil, "sess", "claude-3-5-sonnet-20241022", map[int64]struct{}{1: {}}, "", 0)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(2), selection.Account.ID)
	require.True(t, selection.Acquired)
	require.NotNil(t, selection.ReleaseFunc)
	selection.ReleaseFunc()
	require.Equal(t, int64(1), cache.sessionBindings["sess"], "strict mode must not bind the newly selected account")
}

func TestGatewayService_StrictPriorityFallback_RoutedSessionLimitFallsBackToUnroutedCandidate(t *testing.T) {
	groupID := int64(2)
	repo := strictGatewayTestRepo{stubOpenAIAccountRepo: stubOpenAIAccountRepo{accounts: []Account{
		{
			ID: 1, Platform: PlatformAnthropic, Type: AccountTypeOAuth, Priority: 1,
			Status: StatusActive, Schedulable: true, Concurrency: 1,
			Credentials: map[string]any{"access_token": "token-1"},
			Extra:       map[string]any{"max_sessions": 1},
		},
		{
			ID: 2, Platform: PlatformAnthropic, Type: AccountTypeOAuth, Priority: 2,
			Status: StatusActive, Schedulable: true, Concurrency: 1,
			Credentials: map[string]any{"access_token": "token-2"},
			Extra:       map[string]any{"max_sessions": 1},
		},
	}}}
	groupRepo := strictGroupTestRepo{groups: map[int64]*Group{
		groupID: {
			ID:                  groupID,
			Platform:            PlatformAnthropic,
			Status:              StatusActive,
			Hydrated:            true,
			ModelRoutingEnabled: true,
			ModelRouting: map[string][]int64{
				"claude-3-5-sonnet-20241022": {1},
			},
		},
	}}
	svc := &GatewayService{
		accountRepo:        repo,
		groupRepo:          groupRepo,
		cache:              &stubGatewayCache{},
		cfg:                strictGatewayTestConfig(),
		concurrencyService: NewConcurrencyService(stubConcurrencyCache{}),
		sessionLimitCache: strictSessionLimitCache{
			denyAccountIDs: map[int64]struct{}{1: {}},
		},
	}

	selection, err := svc.SelectAccountWithLoadAwareness(
		context.Background(),
		&groupID,
		"session-limit-fallback",
		"claude-3-5-sonnet-20241022",
		nil,
		"",
		0,
	)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(2), selection.Account.ID, "routed candidate rejected by session limit must fall back to a non-routed candidate")
	if selection.ReleaseFunc != nil {
		selection.ReleaseFunc()
	}
}

func TestGatewayService_StrictPriorityFallback_ModelRoutingFallsBackToUnroutedCandidates(t *testing.T) {
	groupID := int64(1)
	repo := strictGatewayTestRepo{stubOpenAIAccountRepo: stubOpenAIAccountRepo{accounts: []Account{
		{ID: 1, Platform: PlatformAnthropic, Type: AccountTypeAPIKey, Priority: 1, Status: StatusActive, Schedulable: true, Concurrency: 1},
		{ID: 2, Platform: PlatformAnthropic, Type: AccountTypeAPIKey, Priority: 2, Status: StatusActive, Schedulable: true, Concurrency: 1},
	}}}
	groupRepo := strictGroupTestRepo{groups: map[int64]*Group{
		groupID: {
			ID:                  groupID,
			Platform:            PlatformAnthropic,
			Status:              StatusActive,
			Hydrated:            true,
			ModelRoutingEnabled: true,
			ModelRouting: map[string][]int64{
				"claude-3-5-sonnet-20241022": {1},
			},
		},
	}}
	svc := &GatewayService{
		accountRepo:        repo,
		groupRepo:          groupRepo,
		cache:              &stubGatewayCache{},
		cfg:                strictGatewayTestConfig(),
		concurrencyService: NewConcurrencyService(stubConcurrencyCache{}),
	}

	selection, err := svc.SelectAccountWithLoadAwareness(
		context.Background(),
		&groupID,
		"",
		"claude-3-5-sonnet-20241022",
		map[int64]struct{}{1: {}},
		"",
		0,
	)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(2), selection.Account.ID, "unavailable routed account should fall back to strict priority candidates")
	if selection.ReleaseFunc != nil {
		selection.ReleaseFunc()
	}
}

func TestGatewayService_StrictPriorityFallback_IgnoresStickySession(t *testing.T) {
	repo := strictGatewayTestRepo{stubOpenAIAccountRepo: stubOpenAIAccountRepo{accounts: []Account{
		{ID: 1, Platform: PlatformAnthropic, Type: AccountTypeAPIKey, Priority: 2, Status: StatusActive, Schedulable: true, Concurrency: 1},
		{ID: 2, Platform: PlatformAnthropic, Type: AccountTypeAPIKey, Priority: 1, Status: StatusActive, Schedulable: true, Concurrency: 1},
	}}}
	cache := &stubGatewayCache{sessionBindings: map[string]int64{"sess": 1}}
	svc := &GatewayService{
		accountRepo:        repo,
		cache:              cache,
		cfg:                strictGatewayTestConfig(),
		concurrencyService: NewConcurrencyService(stubConcurrencyCache{}),
	}

	selection, err := svc.SelectAccountWithLoadAwareness(context.Background(), nil, "sess", "claude-3-5-sonnet-20241022", nil, "", 0)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(2), selection.Account.ID)
	if selection.ReleaseFunc != nil {
		selection.ReleaseFunc()
	}
	require.Equal(t, int64(1), cache.sessionBindings["sess"], "strict mode must not override priority with an old sticky binding")
}

func TestOpenAIGatewayService_StrictPriorityFallback_IgnoresStickySession(t *testing.T) {
	repo := stubOpenAIAccountRepo{accounts: []Account{
		{ID: 1, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 2, Status: StatusActive, Schedulable: true, Concurrency: 1},
		{ID: 2, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 1, Status: StatusActive, Schedulable: true, Concurrency: 1},
	}}
	cache := &stubGatewayCache{sessionBindings: map[string]int64{"sess": 1}}
	svc := &OpenAIGatewayService{
		accountRepo:        repo,
		cache:              cache,
		cfg:                strictOpenAITestConfig(),
		concurrencyService: NewConcurrencyService(stubConcurrencyCache{}),
	}

	selection, err := svc.SelectAccountWithLoadAwareness(context.Background(), nil, "sess", "gpt-4", nil)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(2), selection.Account.ID)
	if selection.ReleaseFunc != nil {
		selection.ReleaseFunc()
	}
	require.Equal(t, int64(1), cache.sessionBindings["sess"], "strict mode must not override priority with an old sticky binding")
}

type recordingOpenAIScheduler struct {
	selectCalls int
}

func (s *recordingOpenAIScheduler) Select(_ context.Context, _ OpenAIAccountScheduleRequest) (*AccountSelectionResult, OpenAIAccountScheduleDecision, error) {
	s.selectCalls++
	return nil, OpenAIAccountScheduleDecision{}, errors.New("advanced scheduler must not run in strict mode")
}

func (s *recordingOpenAIScheduler) ReportResult(int64, bool, *int) {}

func (s *recordingOpenAIScheduler) ReportSwitch() {}

func (s *recordingOpenAIScheduler) SnapshotMetrics() OpenAIAccountSchedulerMetricsSnapshot {
	return OpenAIAccountSchedulerMetricsSnapshot{}
}

func TestOpenAIGatewayService_StrictPriorityFallback_BypassesAdvancedScheduler(t *testing.T) {
	resetOpenAIAdvancedSchedulerSettingCacheForTest()
	defer resetOpenAIAdvancedSchedulerSettingCacheForTest()

	cfg := strictOpenAITestConfig()
	repo := &openAIAdvancedSchedulerSettingRepoStub{values: map[string]string{
		openAIAdvancedSchedulerSettingKey:                      "true",
		SettingKeyOpenAIAdvancedSchedulerStickyWeightedEnabled: "true",
	}}
	scheduler := &recordingOpenAIScheduler{}
	cache := &stubGatewayCache{sessionBindings: map[string]int64{"sess": 1}}
	svc := &OpenAIGatewayService{
		accountRepo: stubOpenAIAccountRepo{accounts: []Account{
			{ID: 1, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 2, Status: StatusActive, Schedulable: true, Concurrency: 1},
			{ID: 2, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 1, Status: StatusActive, Schedulable: true, Concurrency: 1},
		}},
		cache:              cache,
		cfg:                cfg,
		concurrencyService: NewConcurrencyService(stubConcurrencyCache{}),
		rateLimitService:   &RateLimitService{settingService: NewSettingService(repo, cfg)},
		openaiScheduler:    scheduler,
	}

	selection, decision, err := svc.selectAccountWithSchedulerOnce(
		context.Background(),
		nil,
		"",
		"sess",
		"gpt-4",
		nil,
		OpenAIUpstreamTransportHTTPSSE,
		"",
		"",
		false,
		PlatformOpenAI,
		false,
		false,
	)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(2), selection.Account.ID)
	require.Equal(t, openAIAccountScheduleLayerLoadBalance, decision.Layer)
	require.Zero(t, scheduler.selectCalls)
	require.Equal(t, int64(1), cache.sessionBindings["sess"])
}

func TestOpenAIGatewayService_StrictPriorityFallback_CompactTier0CachedAcceptedAfterDBRecheck(t *testing.T) {
	resetOpenAIAdvancedSchedulerSettingCacheForTest()
	defer resetOpenAIAdvancedSchedulerSettingCacheForTest()

	stalePrimary := &Account{
		ID: 1, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 1,
		Status: StatusActive, Schedulable: true, Concurrency: 1,
		Credentials:    map[string]any{"api_key": "sk-1"},
		RateMultiplier: strictRateMultiplier(1),
		Extra:          map[string]any{"openai_compact_supported": false},
	}
	staleBackup := &Account{
		ID: 2, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 1,
		Status: StatusActive, Schedulable: true, Concurrency: 1,
		Credentials:    map[string]any{"api_key": "sk-2"},
		RateMultiplier: strictRateMultiplier(1),
		Extra:          map[string]any{"openai_compact_supported": true},
	}
	dbPrimary := *stalePrimary
	dbPrimary.Extra = map[string]any{"openai_compact_supported": true}
	dbBackup := *staleBackup
	snapshotCache := &openAISnapshotCacheStub{
		snapshotAccounts: []*Account{stalePrimary, staleBackup},
		accountsByID:     map[int64]*Account{stalePrimary.ID: stalePrimary, staleBackup.ID: staleBackup},
	}
	cfg := strictOpenAITestConfig()
	cfg.RunMode = config.RunModeStandard
	svc := &OpenAIGatewayService{
		accountRepo:        schedulerTestOpenAIAccountRepo{accounts: []Account{dbPrimary, dbBackup}},
		cache:              &stubGatewayCache{},
		cfg:                cfg,
		schedulerSnapshot:  &SchedulerSnapshotService{cache: snapshotCache},
		concurrencyService: NewConcurrencyService(stubConcurrencyCache{}),
	}

	selection, _, err := svc.SelectAccountWithSchedulerForCapability(
		context.Background(),
		nil,
		"",
		"",
		"gpt-4",
		nil,
		OpenAIUpstreamTransportAny,
		OpenAIEndpointCapabilityChatCompletions,
		true,
		false,
		false,
		PlatformOpenAI,
	)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(1), selection.Account.ID, "cached tier-0 account must be accepted when DB recheck shows compact support")
	if selection.ReleaseFunc != nil {
		selection.ReleaseFunc()
	}
}

func TestOpenAIGatewayService_StrictPriorityFallback_RecheckRejectionReleasesAcquiredSlot(t *testing.T) {
	resetOpenAIAdvancedSchedulerSettingCacheForTest()
	defer resetOpenAIAdvancedSchedulerSettingCacheForTest()

	stalePrimary := &Account{
		ID: 1, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 1,
		Status: StatusActive, Schedulable: true, Concurrency: 1,
		Credentials:    map[string]any{"api_key": "sk-1"},
		RateMultiplier: strictRateMultiplier(1),
	}
	staleBackup := &Account{
		ID: 2, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 2,
		Status: StatusActive, Schedulable: true, Concurrency: 1,
		Credentials:    map[string]any{"api_key": "sk-2"},
		RateMultiplier: strictRateMultiplier(1),
	}
	dbPrimary := *stalePrimary
	dbPrimary.Schedulable = false
	dbBackup := *staleBackup
	snapshotCache := &openAISnapshotCacheStub{
		snapshotAccounts: []*Account{stalePrimary, staleBackup},
		accountsByID:     map[int64]*Account{stalePrimary.ID: stalePrimary, staleBackup.ID: staleBackup},
	}
	var acquired, released []int64
	concurrencyCache := schedulerTestConcurrencyCache{acquiredIDs: &acquired, releasedIDs: &released}
	cfg := strictOpenAITestConfig()
	cfg.RunMode = config.RunModeStandard
	svc := &OpenAIGatewayService{
		accountRepo:        schedulerTestOpenAIAccountRepo{accounts: []Account{dbPrimary, dbBackup}},
		cache:              &stubGatewayCache{},
		cfg:                cfg,
		schedulerSnapshot:  &SchedulerSnapshotService{cache: snapshotCache},
		concurrencyService: NewConcurrencyService(concurrencyCache),
	}

	selection, err := svc.SelectAccountWithLoadAwareness(context.Background(), nil, "", "gpt-4", nil)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(2), selection.Account.ID)
	require.Contains(t, acquired, int64(1), "slot must be acquired before the DB recheck")
	require.Contains(t, released, int64(1), "rejected account slot must be released")
	require.NotContains(t, released, int64(2), "successful selection must retain its slot")
	if selection.ReleaseFunc != nil {
		selection.ReleaseFunc()
	}
}

func TestOpenAIGatewayService_StrictPriorityFallback_PreviousResponseOwnerAtMinPriorityWins(t *testing.T) {
	resetOpenAIAdvancedSchedulerSettingCacheForTest()
	defer resetOpenAIAdvancedSchedulerSettingCacheForTest()

	ctx := context.Background()
	groupID := int64(10111)
	accounts := []Account{
		{
			ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 1,
			Status: StatusActive, Schedulable: true, Concurrency: 1,
			Credentials:    map[string]any{"api_key": "sk-11"},
			RateMultiplier: strictRateMultiplier(1),
			Extra:          map[string]any{"openai_apikey_responses_websockets_v2_enabled": true},
		},
		{
			ID: 12, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 1,
			Status: StatusActive, Schedulable: true, Concurrency: 1,
			Credentials:    map[string]any{"api_key": "sk-12"},
			RateMultiplier: strictRateMultiplier(1),
			Extra:          map[string]any{"openai_apikey_responses_websockets_v2_enabled": true},
		},
	}
	cfg := newSchedulerTestOpenAIWSV2Config()
	cfg.Gateway.Scheduling.StrictPriorityFallback = true
	cfg.Gateway.Scheduling.LoadBatchEnabled = true
	svc := &OpenAIGatewayService{
		accountRepo:        schedulerTestOpenAIAccountRepo{accounts: accounts},
		cache:              &stubGatewayCache{},
		cfg:                cfg,
		concurrencyService: NewConcurrencyService(schedulerTestConcurrencyCache{}),
	}
	require.NoError(t, svc.getOpenAIWSStateStore().BindResponseAccount(ctx, groupID, "resp_strict_owner", 11, time.Hour))

	selection, decision, err := svc.SelectAccountWithSchedulerForCapability(
		ctx,
		&groupID,
		"resp_strict_owner",
		"",
		"gpt-4",
		nil,
		OpenAIUpstreamTransportAny,
		OpenAIEndpointCapabilityChatCompletions,
		false,
		false,
		false,
		PlatformOpenAI,
	)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(11), selection.Account.ID, "previous response owner at the current minimum priority must be tried first")
	require.True(t, decision.StickyPreviousHit)
	if selection.ReleaseFunc != nil {
		selection.ReleaseFunc()
	}
}

func TestOpenAIGatewayService_StrictPriorityFallback_PreviousResponseOwnerLowerPriorityFallsBack(t *testing.T) {
	resetOpenAIAdvancedSchedulerSettingCacheForTest()
	defer resetOpenAIAdvancedSchedulerSettingCacheForTest()

	ctx := context.Background()
	groupID := int64(10112)
	accounts := []Account{
		{
			ID: 21, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 5,
			Status: StatusActive, Schedulable: true, Concurrency: 1,
			Credentials:    map[string]any{"api_key": "sk-21"},
			RateMultiplier: strictRateMultiplier(1),
			Extra:          map[string]any{"openai_apikey_responses_websockets_v2_enabled": true},
		},
		{
			ID: 22, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Priority: 0,
			Status: StatusActive, Schedulable: true, Concurrency: 1,
			Credentials:    map[string]any{"api_key": "sk-22"},
			RateMultiplier: strictRateMultiplier(1),
		},
	}
	cfg := newSchedulerTestOpenAIWSV2Config()
	cfg.Gateway.Scheduling.StrictPriorityFallback = true
	cfg.Gateway.Scheduling.LoadBatchEnabled = true
	svc := &OpenAIGatewayService{
		accountRepo:        schedulerTestOpenAIAccountRepo{accounts: accounts},
		cache:              &stubGatewayCache{},
		cfg:                cfg,
		concurrencyService: NewConcurrencyService(schedulerTestConcurrencyCache{}),
	}
	require.NoError(t, svc.getOpenAIWSStateStore().BindResponseAccount(ctx, groupID, "resp_strict_lower_owner", 21, time.Hour))

	selection, decision, err := svc.SelectAccountWithSchedulerForCapability(
		ctx,
		&groupID,
		"resp_strict_lower_owner",
		"",
		"gpt-4",
		nil,
		OpenAIUpstreamTransportAny,
		OpenAIEndpointCapabilityChatCompletions,
		false,
		false,
		false,
		PlatformOpenAI,
	)
	require.NoError(t, err)
	require.NotNil(t, selection)
	require.NotNil(t, selection.Account)
	require.Equal(t, int64(22), selection.Account.ID, "lower-priority previous response owner must not block strict priority selection")
	require.False(t, decision.StickyPreviousHit)
	if selection.ReleaseFunc != nil {
		selection.ReleaseFunc()
	}
}

func TestStrictPriorityFallback_DisablesSameAccountRetry(t *testing.T) {
	account := &Account{
		Type: AccountTypeAPIKey,
		Credentials: map[string]any{
			"pool_mode": true,
		},
	}

	strictCfg := &config.Config{Gateway: config.GatewayConfig{Scheduling: config.GatewaySchedulingConfig{StrictPriorityFallback: true}}}
	legacyCfg := &config.Config{Gateway: config.GatewayConfig{Scheduling: config.GatewaySchedulingConfig{StrictPriorityFallback: false}}}
	require.False(t, (&GatewayService{cfg: strictCfg}).retryableOnSameAccount(account, http.StatusTooManyRequests))
	require.True(t, (&GatewayService{cfg: legacyCfg}).retryableOnSameAccount(account, http.StatusTooManyRequests))
	retryAccount := &Account{
		Type: AccountTypeAPIKey,
		Credentials: map[string]any{
			"custom_error_codes_enabled": true,
			"custom_error_codes":         []any{float64(400)},
		},
	}
	require.False(t, (&GatewayService{cfg: strictCfg}).shouldRetryUpstreamError(retryAccount, http.StatusInternalServerError))
	require.True(t, (&GatewayService{cfg: legacyCfg}).shouldRetryUpstreamError(retryAccount, http.StatusInternalServerError))
	require.False(t, (&OpenAIGatewayService{cfg: strictCfg}).openAIUpstreamRetryableOnSameAccount(account, http.StatusTooManyRequests, "", nil, false, true))
	require.True(t, (&OpenAIGatewayService{cfg: legacyCfg}).openAIUpstreamRetryableOnSameAccount(account, http.StatusTooManyRequests, "", nil, false, true))
}
