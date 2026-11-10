package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

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
		out, err := runPrivacyFilter(privacyTestContext(), nil, nil, apiKey, protocol, body)
		require.NoError(t, err)
		require.Equal(t, body, out)
	})
	t.Run("redacts for an opted-in group", func(t *testing.T) {
		svc := service.NewPrivacyFilterService(&privacyHandlerSettingRepo{}, nil)
		_, err := svc.UpdateConfig(context.Background(), service.PrivacyFilterConfig{Mode: service.PrivacyFilterModeRedact, GroupIDs: []int64{7}, Categories: []string{"credential"}})
		require.NoError(t, err)
		out, err := runPrivacyFilter(privacyTestContext(), nil, svc, apiKey, protocol, body)
		require.NoError(t, err)
		require.NotContains(t, string(out), "abc12345")
	})
	t.Run("surfaces failure so the caller can reject", func(t *testing.T) {
		svc := service.NewPrivacyFilterService(&privacyHandlerSettingRepo{err: errors.New("db down")}, nil)
		_, err := runPrivacyFilter(privacyTestContext(), nil, svc, apiKey, protocol, body)
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

	out, err := runPrivacyFilter(c, nil, svc, apiKey, service.ContentModerationProtocolAnthropicMessages,
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
