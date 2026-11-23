package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestShouldFailoverOpenAIUpstreamResponse_RequestTimeout(t *testing.T) {
	svc := &OpenAIGatewayService{}
	account := &Account{Platform: PlatformOpenAI, Type: AccountTypeAPIKey}
	tests := []struct {
		name   string
		status int
		body   string
		want   bool
	}{
		{"adobe_upstream", http.StatusRequestTimeout, `{"error":{"code":"upstream_unavailable","message":"Upstream request failed","type":"adobe_upstream"}}`, true},
		{"model_overloaded", http.StatusRequestTimeout, `{"error":{"message":"Model is overloaded, please retry later","type":"rate_limit_error"}}`, true},
		{"adobe_throttled", http.StatusRequestTimeout, `{"error":{"message":"adobe throttled: status 429 retry-after=21.48s envoy=false {\"error_code\":\"rate_limited\",\"message\":\"Too many requests. Please try again later.\"}","type":"rate_limit_error"}}`, true},
		{"plain_timeout", http.StatusRequestTimeout, `Request Timeout`, true},
		{"bad_gateway", http.StatusBadGateway, `{"error":{"message":"Upstream service temporarily unavailable","type":"upstream_error"}}`, true},
		{"rate_limit", http.StatusTooManyRequests, `{"error":{"message":"rate limited","type":"rate_limit_error"}}`, true},
		{"method_not_allowed", http.StatusMethodNotAllowed, ``, true},
		{"bad_request", http.StatusBadRequest, `{"error":{"message":"Invalid image size","type":"invalid_request_error"}}`, false},
		{"not_found", http.StatusNotFound, `{"error":{"message":"Not found"}}`, false},
		{"unprocessable_entity", http.StatusUnprocessableEntity, `{"error":{"message":"Invalid request"}}`, false},
		{"cyber_policy", http.StatusRequestTimeout, `{"error":{"code":"cyber_policy","message":"blocked"}}`, false},
		{"context_length", http.StatusRequestTimeout, `{"error":{"code":"context_length_exceeded","message":"Maximum context length exceeded"}}`, false},
		{"context_window", http.StatusRequestTimeout, `{"error":{"message":"Input exceeds the context window"}}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := []byte(tt.body)
			require.Equal(t, tt.want, svc.shouldFailoverOpenAIUpstreamResponse(account, tt.status, extractUpstreamErrorMessage(body), body))
		})
	}
}

// 本 fork 中可 failover 的上游状态码不受自定义错误码拦截（与上游相反）：
// 换号由 Forward 在调用 handleErrorResponse 前完成，这里只确认 408 不会被当作“未启用的错误码”吞掉。
func TestOpenAIRequestTimeout_CustomErrorCodesDoNotSwallowFailoverStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	account := &Account{
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		Credentials: map[string]any{
			"custom_error_codes_enabled": true,
			"custom_error_codes":         []any{float64(http.StatusTooManyRequests)},
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusRequestTimeout,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"Upstream request failed","type":"adobe_upstream"}}`)),
	}
	result, err := (&OpenAIGatewayService{}).handleErrorResponse(context.Background(), resp, c, account, nil)
	require.Nil(t, result)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "not in custom error codes")
	require.True(t, c.Writer.Written())
}
