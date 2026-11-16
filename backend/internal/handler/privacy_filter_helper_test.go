package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

type privacyHandlerSettingRepo struct {
	service.SettingRepository
	value string
	err   error
}

func (s *privacyHandlerSettingRepo) GetValue(context.Context, string) (string, error) {
	return s.value, s.err
}

func (s *privacyHandlerSettingRepo) Set(_ context.Context, _ string, value string) error {
	s.value = value
	return nil
}

func privacyTestContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	return c
}

func TestRunPrivacyFilter(t *testing.T) {
	group := int64(7)
	apiKey := &service.APIKey{GroupID: &group}
	body := []byte(`{"messages":[{"role":"user","content":"password: abc12345"}]}`)
	protocol := service.ContentModerationProtocolAnthropicMessages

	t.Run("nil service passes through", func(t *testing.T) {
		out, err := runPrivacyFilter(privacyTestContext(), nil, nil, apiKey, protocol, "claude-test", body)
		require.NoError(t, err)
		require.Equal(t, body, out)
	})
	t.Run("redacts for an opted-in group", func(t *testing.T) {
		svc := service.NewPrivacyFilterService(&privacyHandlerSettingRepo{}, nil)
		_, err := svc.UpdateConfig(context.Background(), service.PrivacyFilterConfig{Mode: service.PrivacyFilterModeRedact, GroupIDs: []int64{7}, Categories: []string{"credential"}})
		require.NoError(t, err)
		out, err := runPrivacyFilter(privacyTestContext(), nil, svc, apiKey, protocol, "claude-test", body)
		require.NoError(t, err)
		require.NotContains(t, string(out), "abc12345")
	})
	t.Run("surfaces failure so the caller can reject", func(t *testing.T) {
		svc := service.NewPrivacyFilterService(&privacyHandlerSettingRepo{err: errors.New("db down")}, nil)
		_, err := runPrivacyFilter(privacyTestContext(), nil, svc, apiKey, protocol, "claude-test", body)
		require.ErrorIs(t, err, service.ErrPrivacyFilterFailed)
	})
}

func TestRunPrivacyFilterRestoreModeInstallsWriter(t *testing.T) {
	group := int64(7)
	apiKey := &service.APIKey{ID: 3, GroupID: &group}
	svc := service.NewPrivacyFilterService(&privacyHandlerSettingRepo{}, nil)
	_, err := svc.UpdateConfig(context.Background(), service.PrivacyFilterConfig{Mode: service.PrivacyFilterModeRestore, GroupIDs: []int64{7}, Categories: []string{"credential"}})
	require.NoError(t, err)

	recorder := httptest.NewRecorder()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	original := c.Writer

	out, err := runPrivacyFilter(c, nil, svc, apiKey, service.ContentModerationProtocolAnthropicMessages, "claude-test",
		[]byte(`{"messages":[{"role":"user","content":"password: abc12345"}]}`))
	require.NoError(t, err)
	require.NotContains(t, string(out), "abc12345")
	require.NotEqual(t, original, c.Writer)

	token := gjson.GetBytes(out, "messages.0.content").String()[len("password: "):]
	c.Header("Content-Type", "application/json")
	c.Status(http.StatusOK)
	_, err = c.Writer.Write([]byte(`{"content":[{"type":"text","text":"got ` + token + `"}]}`))
	require.NoError(t, err)
	finishPrivacyRestore(c)

	require.Equal(t, original, c.Writer)
	require.Equal(t, "got abc12345", gjson.Get(recorder.Body.String(), "content.0.text").String())
	require.EqualValues(t, 1, svc.GetStatus().RestoredTokens)
}

type privacyEventRepoStub struct {
	mu     sync.Mutex
	events []*service.PrivacyFilterEvent
}

func (r *privacyEventRepoStub) BatchInsert(_ context.Context, events []*service.PrivacyFilterEvent) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, events...)
	return int64(len(events)), nil
}

func (r *privacyEventRepoStub) List(context.Context, *service.PrivacyFilterEventFilter) (*service.PrivacyFilterEventList, error) {
	return &service.PrivacyFilterEventList{}, nil
}

func TestRunPrivacyFilterRecordsEvents(t *testing.T) {
	group := int64(7)
	apiKey := &service.APIKey{
		ID: 3, UserID: 42, Name: "ci-key", GroupID: &group,
		User:  &service.User{ID: 42, Email: "dev@example.com"},
		Group: &service.Group{ID: 7, Name: "claude-pro"},
	}
	protocol := service.ContentModerationProtocolAnthropicMessages
	newService := func(t *testing.T, settings *privacyHandlerSettingRepo, mode string) (*service.PrivacyFilterService, *privacyEventRepoStub) {
		svc := service.NewPrivacyFilterService(settings, nil)
		if mode != "" {
			_, err := svc.UpdateConfig(context.Background(), service.PrivacyFilterConfig{Mode: mode, GroupIDs: []int64{7}, Categories: []string{"credential"}})
			require.NoError(t, err)
		}
		repo := &privacyEventRepoStub{}
		svc.AttachEventStore(repo)
		return svc, repo
	}
	contextWithRequestID := func() *gin.Context {
		c := privacyTestContext()
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), ctxkey.RequestID, "req-1"))
		return c
	}

	t.Run("hit stores categories but never the matched text", func(t *testing.T) {
		svc, repo := newService(t, &privacyHandlerSettingRepo{}, service.PrivacyFilterModeRedact)
		_, err := runPrivacyFilter(contextWithRequestID(), nil, svc, apiKey, protocol, "claude-test",
			[]byte(`{"messages":[{"role":"user","content":"password: abc12345"}]}`))
		require.NoError(t, err)
		svc.Stop()

		require.Len(t, repo.events, 1)
		event := repo.events[0]
		require.Equal(t, service.PrivacyFilterModeRedact, event.Action)
		require.Equal(t, "local:req-1", event.RequestID)
		require.Equal(t, "claude-test", event.Model)
		require.Equal(t, int64(42), *event.UserID)
		require.Equal(t, "dev@example.com", event.UserEmail)
		require.Equal(t, int64(3), *event.APIKeyID)
		require.Equal(t, "ci-key", event.APIKeyName)
		require.Equal(t, int64(7), *event.GroupID)
		require.Equal(t, "claude-pro", event.GroupName)
		require.Equal(t, map[string]int{"credential": 1}, event.Categories)
		require.Equal(t, 1, event.TotalHits)
		encoded, err := json.Marshal(event)
		require.NoError(t, err)
		require.NotContains(t, string(encoded), "abc12345")
	})
	t.Run("no hit stores nothing", func(t *testing.T) {
		svc, repo := newService(t, &privacyHandlerSettingRepo{}, service.PrivacyFilterModeRedact)
		_, err := runPrivacyFilter(contextWithRequestID(), nil, svc, apiKey, protocol, "claude-test",
			[]byte(`{"messages":[{"role":"user","content":"hello"}]}`))
		require.NoError(t, err)
		svc.Stop()
		require.Empty(t, repo.events)
	})
	t.Run("failure stores a failed record", func(t *testing.T) {
		svc, repo := newService(t, &privacyHandlerSettingRepo{err: errors.New("db down")}, "")
		_, err := runPrivacyFilter(contextWithRequestID(), nil, svc, apiKey, protocol, "claude-test",
			[]byte(`{"messages":[{"role":"user","content":"password: abc12345"}]}`))
		require.ErrorIs(t, err, service.ErrPrivacyFilterFailed)
		svc.Stop()
		require.Len(t, repo.events, 1)
		require.Equal(t, service.PrivacyFilterEventActionFailed, repo.events[0].Action)
		require.Empty(t, repo.events[0].Categories)
	})
}
