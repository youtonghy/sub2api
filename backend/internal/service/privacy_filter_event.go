package service

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// PrivacyFilterEventActionFailed marks a request that was rejected because
	// the filter could not process it. The other actions reuse the mode names.
	PrivacyFilterEventActionFailed = "failed"

	privacyFilterEventQueueCapacity = 4096
	privacyFilterEventBatchSize     = 200
	privacyFilterEventFlushInterval = time.Second
)

// PrivacyFilterEvent records that one request hit the privacy filter. It holds
// categories and counts only, never the matched text or where it was found.
type PrivacyFilterEvent struct {
	ID         int64          `json:"id"`
	CreatedAt  time.Time      `json:"created_at"`
	RequestID  string         `json:"request_id"`
	UserID     *int64         `json:"user_id,omitempty"`
	UserEmail  string         `json:"user_email"`
	APIKeyID   *int64         `json:"api_key_id,omitempty"`
	APIKeyName string         `json:"api_key_name"`
	GroupID    *int64         `json:"group_id,omitempty"`
	GroupName  string         `json:"group_name"`
	Endpoint   string         `json:"endpoint"`
	Protocol   string         `json:"protocol"`
	Model      string         `json:"model"`
	Action     string         `json:"action"`
	Fields     int            `json:"fields"`
	TotalHits  int            `json:"total_hits"`
	Categories map[string]int `json:"categories"`
}

// PrivacyFilterEventFilter selects events. EndTime is exclusive.
type PrivacyFilterEventFilter struct {
	Page     int
	PageSize int

	StartTime *time.Time
	EndTime   *time.Time
	UserID    *int64
	APIKeyID  *int64
	GroupID   *int64
	Action    string
	Category  string
	RequestID string
	// Query matches user email, API key name and model (admin only).
	Query string
}

// PrivacyFilterEventList is one page of events.
type PrivacyFilterEventList struct {
	Items    []*PrivacyFilterEvent
	Total    int64
	Page     int
	PageSize int
}

// PrivacyFilterEventRepository stores events. Expired rows are removed together
// with usage_logs by DashboardAggregationService.
type PrivacyFilterEventRepository interface {
	BatchInsert(ctx context.Context, events []*PrivacyFilterEvent) (int64, error)
	List(ctx context.Context, filter *PrivacyFilterEventFilter) (*PrivacyFilterEventList, error)
}

// privacyFilterEventWriter persists events in the background. Recording never
// blocks a gateway request: when the queue is full the event is dropped and
// counted, because these records are informational and not billing data.
type privacyFilterEventWriter struct {
	repo  PrivacyFilterEventRepository
	queue chan *PrivacyFilterEvent

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	dropped, writeFailed atomic.Int64
}

func newPrivacyFilterEventWriter(repo PrivacyFilterEventRepository) *privacyFilterEventWriter {
	ctx, cancel := context.WithCancel(context.Background())
	return &privacyFilterEventWriter{
		repo:   repo,
		queue:  make(chan *PrivacyFilterEvent, privacyFilterEventQueueCapacity),
		ctx:    ctx,
		cancel: cancel,
	}
}

func (w *privacyFilterEventWriter) start() {
	w.wg.Add(1)
	go w.run()
}

func (w *privacyFilterEventWriter) stop() {
	w.cancel()
	w.wg.Wait()
}

func (w *privacyFilterEventWriter) record(event *PrivacyFilterEvent) {
	select {
	case <-w.ctx.Done():
		w.dropped.Add(1)
		return
	default:
	}
	select {
	case w.queue <- event:
	default:
		if w.dropped.Add(1) == 1 {
			slog.Warn("privacy_filter.event_queue_full")
		}
	}
}

func (w *privacyFilterEventWriter) run() {
	defer w.wg.Done()
	ticker := time.NewTicker(privacyFilterEventFlushInterval)
	defer ticker.Stop()

	batch := make([]*PrivacyFilterEvent, 0, privacyFilterEventBatchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := w.repo.BatchInsert(ctx, batch)
		cancel()
		if err != nil {
			w.writeFailed.Add(int64(len(batch)))
			slog.Warn("privacy_filter.event_flush_failed", "batch", len(batch), "error", err)
		}
		batch = batch[:0]
	}
	add := func(event *PrivacyFilterEvent) {
		batch = append(batch, event)
		if len(batch) >= privacyFilterEventBatchSize {
			flush()
		}
	}

	for {
		select {
		case <-w.ctx.Done():
			for {
				select {
				case event := <-w.queue:
					add(event)
				default:
					flush()
					return
				}
			}
		case event := <-w.queue:
			add(event)
		case <-ticker.C:
			flush()
		}
	}
}

// AttachEventStore enables per-request records and starts the background
// writer. Without it the service keeps working and records nothing.
func (s *PrivacyFilterService) AttachEventStore(repo PrivacyFilterEventRepository) {
	if s == nil || repo == nil || s.events != nil {
		return
	}
	s.eventRepo = repo
	s.events = newPrivacyFilterEventWriter(repo)
	s.events.start()
}

// Stop flushes queued records. It is safe to call when no store is attached.
func (s *PrivacyFilterService) Stop() {
	if s == nil || s.events == nil {
		return
	}
	s.events.stop()
}

// RecordEvent queues an event without blocking. Events with no hits that did
// not fail are ignored, as are events when no store is attached.
func (s *PrivacyFilterService) RecordEvent(event *PrivacyFilterEvent) {
	if s == nil || s.events == nil || event == nil {
		return
	}
	if event.Action != PrivacyFilterEventActionFailed && len(event.Categories) == 0 {
		return
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}
	if event.TotalHits == 0 {
		for _, count := range event.Categories {
			event.TotalHits += count
		}
	}
	s.events.record(event)
}

// ListEvents returns one page of events. Callers scope the filter: the user API
// must always set UserID.
func (s *PrivacyFilterService) ListEvents(ctx context.Context, filter *PrivacyFilterEventFilter) (*PrivacyFilterEventList, error) {
	if s == nil || s.eventRepo == nil {
		return &PrivacyFilterEventList{Items: []*PrivacyFilterEvent{}, Page: 1, PageSize: 20}, nil
	}
	if filter == nil {
		filter = &PrivacyFilterEventFilter{}
	}
	filter.Action = strings.TrimSpace(filter.Action)
	filter.Category = strings.TrimSpace(filter.Category)
	return s.eventRepo.List(ctx, filter)
}

func (s *PrivacyFilterService) eventCounters() (dropped, failed int64) {
	if s == nil || s.events == nil {
		return 0, 0
	}
	return s.events.dropped.Load(), s.events.writeFailed.Load()
}
