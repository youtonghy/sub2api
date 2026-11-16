package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type privacyEventListCapture struct {
	privacyEventRepoStub
	filter *service.PrivacyFilterEventFilter
}

func (r *privacyEventListCapture) List(_ context.Context, filter *service.PrivacyFilterEventFilter) (*service.PrivacyFilterEventList, error) {
	r.filter = filter
	userID := int64(42)
	return &service.PrivacyFilterEventList{
		Items: []*service.PrivacyFilterEvent{{
			ID: 1, CreatedAt: time.Now(), UserID: &userID, UserEmail: "dev@example.com",
			RequestID: "local:req-1", Endpoint: "/v1/messages", GroupName: "claude-pro",
			Action: service.PrivacyFilterModeRedact, Categories: map[string]int{"credential": 2}, TotalHits: 2,
		}},
		Total: 1, Page: 1, PageSize: 20,
	}, nil
}

type privacyAPIKeyRepoStub struct {
	service.APIKeyRepository
	keys map[int64]*service.APIKey
}

func (r *privacyAPIKeyRepoStub) GetByID(_ context.Context, id int64) (*service.APIKey, error) {
	if key, ok := r.keys[id]; ok {
		copied := *key
		return &copied, nil
	}
	return nil, service.ErrAPIKeyNotFound
}

func newPrivacyUserHandler(t *testing.T) (*PrivacyFilterHandler, *privacyEventListCapture) {
	t.Helper()
	repo := &privacyEventListCapture{}
	svc := service.NewPrivacyFilterService(&privacyHandlerSettingRepo{}, nil)
	svc.AttachEventStore(repo)
	t.Cleanup(svc.Stop)
	keys := &privacyAPIKeyRepoStub{keys: map[int64]*service.APIKey{
		5: {ID: 5, UserID: 42},
		6: {ID: 6, UserID: 99},
	}}
	return NewPrivacyFilterHandler(svc, service.NewAPIKeyService(keys, nil, nil, nil, nil, nil, &config.Config{})), repo
}

func servePrivacyEvents(h *PrivacyFilterHandler, query string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/privacy-filter/events"+query, nil)
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 42})
	h.ListEvents(c)
	return recorder
}

func TestPrivacyFilterUserEventsAreScopedToCaller(t *testing.T) {
	h, repo := newPrivacyUserHandler(t)

	recorder := servePrivacyEvents(h, "?user_id=99&api_key_id=5&category=credential&action=redact&start_date=2026-11-01&end_date=2026-11-16")

	require.Equal(t, http.StatusOK, recorder.Code)
	require.NotNil(t, repo.filter)
	require.Equal(t, int64(42), *repo.filter.UserID)
	require.Equal(t, int64(5), *repo.filter.APIKeyID)
	require.Equal(t, "credential", repo.filter.Category)
	require.Equal(t, service.PrivacyFilterModeRedact, repo.filter.Action)
	require.True(t, repo.filter.EndTime.After(*repo.filter.StartTime))
	// Fields only administrators see are left out.
	body := recorder.Body.String()
	require.NotContains(t, body, "dev@example.com")
	require.NotContains(t, body, "local:req-1")
	require.NotContains(t, body, "claude-pro")
	require.Contains(t, body, `"credential":2`)
}

func TestPrivacyFilterUserEventsRejectsOtherUsersKey(t *testing.T) {
	h, repo := newPrivacyUserHandler(t)

	recorder := servePrivacyEvents(h, "?api_key_id=6")

	require.Equal(t, http.StatusForbidden, recorder.Code)
	require.Nil(t, repo.filter)
}

func TestPrivacyFilterUserEventsRejectsBadFilters(t *testing.T) {
	h, repo := newPrivacyUserHandler(t)

	for _, query := range []string{"?category=nope", "?action=nope", "?start_date=2026-13-01", "?start_date=2026-11-10&end_date=2026-11-01"} {
		recorder := servePrivacyEvents(h, query)
		require.Equal(t, http.StatusBadRequest, recorder.Code, query)
	}
	require.Nil(t, repo.filter)
}
