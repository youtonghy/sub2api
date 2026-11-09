package service

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/privacyfilter"
	"github.com/dgraph-io/ristretto"
)

const (
	PrivacyFilterModeOff     = "off"
	PrivacyFilterModeObserve = "observe"
	PrivacyFilterModeRedact  = "redact"

	// PrivacyFilterProtocolEmbeddings identifies /v1/embeddings bodies.
	PrivacyFilterProtocolEmbeddings = "openai_embeddings"

	privacyFilterSnapshotTTL = 5 * time.Second

	// Blocks below this size are cheaper to scan than to cache.
	privacyFilterCacheMinBytes = 512
	privacyFilterCacheMaxBytes = 64 << 20
)

// ErrPrivacyFilterFailed means a request in redact mode could not be rewritten
// and must not be forwarded.
var ErrPrivacyFilterFailed = errors.New("privacy filter failed")

// PrivacyFilterConfig is stored as JSON under SettingKeyPrivacyFilterConfig.
type PrivacyFilterConfig struct {
	Mode       string   `json:"mode"`
	GroupIDs   []int64  `json:"group_ids"`
	Categories []string `json:"categories"`
}

// PrivacyFilterInput describes one request body to process.
type PrivacyFilterInput struct {
	GroupID  *int64
	Protocol string
	Body     []byte
}

// PrivacyFilterResult carries the body to forward and category counts. It never
// contains matched values.
type PrivacyFilterResult struct {
	Body    []byte
	Mode    string
	Changed bool
	Fields  int
	Counts  map[string]int
}

// PrivacyFilterStatus reports counters for this process since it started.
type PrivacyFilterStatus struct {
	ScannedRequests  int64            `json:"scanned_requests"`
	HitRequests      int64            `json:"hit_requests"`
	RedactedRequests int64            `json:"redacted_requests"`
	FailedRequests   int64            `json:"failed_requests"`
	Fields           int64            `json:"fields"`
	CategoryCounts   map[string]int64 `json:"category_counts"`
	StartedAt        time.Time        `json:"started_at"`
}

type privacyFilterSnapshot struct {
	config     PrivacyFilterConfig
	groups     map[int64]struct{}
	categories privacyfilter.CategorySet
	loadedAt   time.Time
}

type privacyFilterCacheEntry struct {
	text    string
	changed bool
	counts  map[privacyfilter.Category]int
}

// PrivacyFilterService applies irreversible redaction for the groups an
// administrator has opted in. Everything is off by default.
type PrivacyFilterService struct {
	settingRepo SettingRepository
	detector    func() (*privacyfilter.Detector, error)

	snapshot  atomic.Pointer[privacyFilterSnapshot]
	refreshMu sync.Mutex

	cacheOnce sync.Once
	cache     *ristretto.Cache

	scanned, hit, redacted, failed, fields atomic.Int64
	categoryCounts                         map[privacyfilter.Category]*atomic.Int64
	startedAt                              time.Time
}

// NewPrivacyFilterService creates the service. Rules are compiled on first use,
// so deployments that keep the feature off pay nothing.
func NewPrivacyFilterService(settingRepo SettingRepository) *PrivacyFilterService {
	counts := make(map[privacyfilter.Category]*atomic.Int64)
	for _, category := range privacyfilter.AllCategories() {
		counts[category] = new(atomic.Int64)
	}
	return &PrivacyFilterService{
		settingRepo:    settingRepo,
		detector:       privacyfilter.Shared,
		categoryCounts: counts,
		startedAt:      time.Now(),
	}
}

func defaultPrivacyFilterCategories() []string {
	defaults := privacyfilter.DefaultCategories()
	names := make([]string, len(defaults))
	for i, category := range defaults {
		names[i] = string(category)
	}
	return names
}

func defaultPrivacyFilterConfig() PrivacyFilterConfig {
	return PrivacyFilterConfig{
		Mode:       PrivacyFilterModeOff,
		GroupIDs:   []int64{},
		Categories: defaultPrivacyFilterCategories(),
	}
}

func parsePrivacyFilterConfig(raw string) (PrivacyFilterConfig, error) {
	config := defaultPrivacyFilterConfig()
	if raw == "" {
		return config, nil
	}
	config.Categories = nil
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		return PrivacyFilterConfig{}, fmt.Errorf("parse privacy filter config: %w", err)
	}
	if config.Categories == nil {
		config.Categories = defaultPrivacyFilterCategories()
	}
	if config.GroupIDs == nil {
		config.GroupIDs = []int64{}
	}
	return config, nil
}

func validatePrivacyFilterConfig(config PrivacyFilterConfig) error {
	switch config.Mode {
	case PrivacyFilterModeOff, PrivacyFilterModeObserve, PrivacyFilterModeRedact:
	default:
		return infraerrors.BadRequest("INVALID_PRIVACY_FILTER_MODE", "隐私过滤模式无效")
	}
	for _, category := range config.Categories {
		if !privacyfilter.IsValidCategory(category) {
			return infraerrors.BadRequest("INVALID_PRIVACY_FILTER_CATEGORY", "隐私过滤类别无效: "+category)
		}
	}
	for _, id := range config.GroupIDs {
		if id <= 0 {
			return infraerrors.BadRequest("INVALID_PRIVACY_FILTER_GROUP", "隐私过滤分组无效")
		}
	}
	return nil
}

func newPrivacyFilterSnapshot(config PrivacyFilterConfig) *privacyFilterSnapshot {
	groups := make(map[int64]struct{}, len(config.GroupIDs))
	for _, id := range config.GroupIDs {
		groups[id] = struct{}{}
	}
	names := make([]privacyfilter.Category, len(config.Categories))
	for i, category := range config.Categories {
		names[i] = privacyfilter.Category(category)
	}
	return &privacyFilterSnapshot{
		config:     config,
		groups:     groups,
		categories: privacyfilter.NewCategorySet(names...),
		loadedAt:   time.Now(),
	}
}

// GetConfig returns the stored configuration, or the defaults when unset.
func (s *PrivacyFilterService) GetConfig(ctx context.Context) (PrivacyFilterConfig, error) {
	raw, err := s.settingRepo.GetValue(ctx, SettingKeyPrivacyFilterConfig)
	if err != nil {
		if errors.Is(err, ErrSettingNotFound) {
			return defaultPrivacyFilterConfig(), nil
		}
		return PrivacyFilterConfig{}, fmt.Errorf("get privacy filter config: %w", err)
	}
	return parsePrivacyFilterConfig(raw)
}

// UpdateConfig validates and stores a configuration. Other instances pick it up
// within privacyFilterSnapshotTTL.
func (s *PrivacyFilterService) UpdateConfig(ctx context.Context, config PrivacyFilterConfig) (PrivacyFilterConfig, error) {
	if config.GroupIDs == nil {
		config.GroupIDs = []int64{}
	}
	if config.Categories == nil {
		config.Categories = defaultPrivacyFilterCategories()
	}
	sort.Slice(config.GroupIDs, func(i, j int) bool { return config.GroupIDs[i] < config.GroupIDs[j] })
	if err := validatePrivacyFilterConfig(config); err != nil {
		return PrivacyFilterConfig{}, err
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return PrivacyFilterConfig{}, fmt.Errorf("marshal privacy filter config: %w", err)
	}
	if err := s.settingRepo.Set(ctx, SettingKeyPrivacyFilterConfig, string(raw)); err != nil {
		return PrivacyFilterConfig{}, fmt.Errorf("save privacy filter config: %w", err)
	}
	s.snapshot.Store(newPrivacyFilterSnapshot(config))
	return config, nil
}

// GetStatus returns this process's counters.
func (s *PrivacyFilterService) GetStatus() PrivacyFilterStatus {
	counts := make(map[string]int64, len(s.categoryCounts))
	for category, counter := range s.categoryCounts {
		counts[string(category)] = counter.Load()
	}
	return PrivacyFilterStatus{
		ScannedRequests:  s.scanned.Load(),
		HitRequests:      s.hit.Load(),
		RedactedRequests: s.redacted.Load(),
		FailedRequests:   s.failed.Load(),
		Fields:           s.fields.Load(),
		CategoryCounts:   counts,
		StartedAt:        s.startedAt,
	}
}

// currentSnapshot keeps serving the last good snapshot when a refresh fails, so
// a settings outage cannot switch redaction off. It errors only when no
// configuration has ever been loaded.
func (s *PrivacyFilterService) currentSnapshot(ctx context.Context) (*privacyFilterSnapshot, error) {
	current := s.snapshot.Load()
	if current != nil && time.Since(current.loadedAt) < privacyFilterSnapshotTTL {
		return current, nil
	}
	if !s.refreshMu.TryLock() {
		if current != nil {
			return current, nil
		}
		s.refreshMu.Lock()
	}
	defer s.refreshMu.Unlock()

	if latest := s.snapshot.Load(); latest != nil && time.Since(latest.loadedAt) < privacyFilterSnapshotTTL {
		return latest, nil
	}
	config, err := s.GetConfig(ctx)
	if err != nil {
		if current != nil {
			slog.Warn("privacy_filter.config_refresh_failed", "error", err)
			return current, nil
		}
		return nil, err
	}
	refreshed := newPrivacyFilterSnapshot(config)
	s.snapshot.Store(refreshed)
	return refreshed, nil
}

// Apply scans a request body. In observe mode the body is returned untouched and
// failures are only counted. In redact mode any failure is returned as
// ErrPrivacyFilterFailed so the caller rejects the request rather than forward
// text it could not process.
func (s *PrivacyFilterService) Apply(ctx context.Context, input PrivacyFilterInput) (result PrivacyFilterResult, err error) {
	result = PrivacyFilterResult{Body: input.Body, Mode: PrivacyFilterModeOff}
	if s == nil || input.GroupID == nil || len(input.Body) == 0 {
		return result, nil
	}
	snapshot, err := s.currentSnapshot(ctx)
	if err != nil {
		s.failed.Add(1)
		return result, fmt.Errorf("%w: %v", ErrPrivacyFilterFailed, err)
	}
	if snapshot.config.Mode == PrivacyFilterModeOff || snapshot.categories == 0 {
		return result, nil
	}
	if _, enabled := snapshot.groups[*input.GroupID]; !enabled {
		return result, nil
	}
	result.Mode = snapshot.config.Mode
	s.scanned.Add(1)

	rewritten, err := s.rewrite(input.Protocol, input.Body, snapshot.categories)
	if err != nil {
		s.failed.Add(1)
		if snapshot.config.Mode == PrivacyFilterModeObserve {
			slog.Warn("privacy_filter.observe_failed", "protocol", input.Protocol, "error", err)
			return result, nil
		}
		return result, fmt.Errorf("%w: %v", ErrPrivacyFilterFailed, err)
	}

	result.Fields = rewritten.fields
	if len(rewritten.counts) == 0 {
		return result, nil
	}
	result.Counts = make(map[string]int, len(rewritten.counts))
	for category, count := range rewritten.counts {
		result.Counts[string(category)] = count
		if counter := s.categoryCounts[category]; counter != nil {
			counter.Add(int64(count))
		}
	}
	s.hit.Add(1)
	s.fields.Add(int64(rewritten.fields))
	if snapshot.config.Mode == PrivacyFilterModeRedact {
		result.Body = rewritten.body
		result.Changed = true
		s.redacted.Add(1)
	}
	return result, nil
}

// rewrite converts panics into errors: a detector bug must surface through the
// fail-closed path instead of taking the request down unaccounted for.
func (s *PrivacyFilterService) rewrite(protocol string, body []byte, categories privacyfilter.CategorySet) (out privacyRewriteOutput, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("panic while filtering: %v", recovered)
		}
	}()
	detector, err := s.detector()
	if err != nil {
		return privacyRewriteOutput{}, err
	}
	return rewritePrivacyBody(protocol, body, func(text string) privacyfilter.Result {
		return s.redactCached(detector, text, categories)
	})
}

func (s *PrivacyFilterService) blockCache() *ristretto.Cache {
	s.cacheOnce.Do(func() {
		cache, err := ristretto.NewCache(&ristretto.Config{
			NumCounters: 1_000_000,
			MaxCost:     privacyFilterCacheMaxBytes,
			BufferItems: 64,
		})
		if err != nil {
			slog.Warn("privacy_filter.cache_disabled", "error", err)
			return
		}
		s.cache = cache
	})
	return s.cache
}

// redactCached memoises large blocks. Clients resend the whole conversation on
// every turn, so most text was already scanned on a previous request. Only the
// redacted output is held; a cached entry never contains an original value.
func (s *PrivacyFilterService) redactCached(detector *privacyfilter.Detector, text string, categories privacyfilter.CategorySet) privacyfilter.Result {
	if len(text) < privacyFilterCacheMinBytes {
		return detector.Redact(text, categories)
	}
	cache := s.blockCache()
	if cache == nil {
		return detector.Redact(text, categories)
	}
	var prefix [2]byte
	binary.LittleEndian.PutUint16(prefix[:], uint16(categories))
	hasher := sha256.New()
	hasher.Write(prefix[:])
	hasher.Write([]byte(text))
	key := string(hasher.Sum(nil))

	if value, found := cache.Get(key); found {
		if entry, ok := value.(privacyFilterCacheEntry); ok {
			if !entry.changed {
				return privacyfilter.Result{Text: text}
			}
			return privacyfilter.Result{Text: entry.text, Changed: true, Counts: entry.counts}
		}
	}
	result := detector.Redact(text, categories)
	entry := privacyFilterCacheEntry{changed: result.Changed, counts: result.Counts}
	cost := int64(128)
	if result.Changed {
		entry.text = result.Text
		cost += int64(len(result.Text))
	}
	cache.Set(key, entry, cost)
	return result
}
