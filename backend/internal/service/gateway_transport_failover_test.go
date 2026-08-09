package service

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newGatewayTransportFailoverTestService(upstream *anthropicHTTPUpstreamRecorder) *GatewayService {
	return &GatewayService{
		cfg: &config.Config{
			Security: config.SecurityConfig{
				URLAllowlist: config.URLAllowlistConfig{
					Enabled:           false,
					AllowInsecureHTTP: true,
				},
			},
		},
		httpUpstream:     upstream,
		rateLimitService: &RateLimitService{},
		deferredService:  &DeferredService{},
	}
}

func TestGatewayService_Forward_TransportErrorReturnsFailoverErrorWithoutWriting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := []byte(`{"model":"claude-3-5-sonnet-latest","stream":false,"messages":[{"role":"user","content":"hello"}]}`)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewReader(body))

	parsed, err := ParseGatewayRequest(NewRequestBodyRef(body), PlatformAnthropic)
	require.NoError(t, err)

	upstream := &anthropicHTTPUpstreamRecorder{err: errors.New("dial tcp 1.2.3.4:443: connect: connection refused")}
	svc := newGatewayTransportFailoverTestService(upstream)
	account := newAnthropicAPIKeyAccountForTest()
	delete(account.Extra, "anthropic_passthrough")

	_, err = svc.Forward(context.Background(), c, account, parsed)
	require.Error(t, err)
	var failoverErr *UpstreamFailoverError
	require.True(t, errors.As(err, &failoverErr), "transport error should return UpstreamFailoverError, got: %T", err)
	require.Equal(t, http.StatusBadGateway, failoverErr.StatusCode)
	require.False(t, failoverErr.RetryableOnSameAccount)
	require.JSONEq(t, anthropicTransportFailoverBody, string(failoverErr.ResponseBody))
	require.Equal(t, http.StatusOK, rec.Code, "transport error must not write a terminal response")
	require.Empty(t, rec.Body.String())
}

func TestGatewayService_Forward_TransportErrorClientCanceledDoesNotFailOver(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := []byte(`{"model":"claude-3-5-sonnet-latest","stream":false,"messages":[{"role":"user","content":"hello"}]}`)
	cancelCtx, cancel := context.WithCancel(context.Background())
	cancel()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewReader(body)).WithContext(cancelCtx)

	parsed, err := ParseGatewayRequest(NewRequestBodyRef(body), PlatformAnthropic)
	require.NoError(t, err)

	upstream := &anthropicHTTPUpstreamRecorder{err: context.Canceled}
	svc := newGatewayTransportFailoverTestService(upstream)
	account := newAnthropicAPIKeyAccountForTest()
	delete(account.Extra, "anthropic_passthrough")

	_, err = svc.Forward(context.Background(), c, account, parsed)
	require.Error(t, err)
	var failoverErr *UpstreamFailoverError
	require.False(t, errors.As(err, &failoverErr), "client-canceled transport error must not trigger failover")
	require.Empty(t, rec.Body.String())
}

func TestGatewayService_ForwardAsResponses_TransportErrorReturnsFailoverErrorWithoutWriting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := []byte(`{"model":"claude-3-5-sonnet-latest","stream":false,"input":"hello"}`)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))

	upstream := &anthropicHTTPUpstreamRecorder{err: errors.New("dial tcp: i/o timeout")}
	svc := newGatewayTransportFailoverTestService(upstream)
	account := newAnthropicAPIKeyAccountForTest()

	_, err := svc.ForwardAsResponses(context.Background(), c, account, body, nil)
	require.Error(t, err)
	var failoverErr *UpstreamFailoverError
	require.True(t, errors.As(err, &failoverErr), "transport error should return UpstreamFailoverError, got: %T", err)
	require.Equal(t, http.StatusBadGateway, failoverErr.StatusCode)
	require.JSONEq(t, anthropicTransportFailoverBody, string(failoverErr.ResponseBody))
	require.Equal(t, http.StatusOK, rec.Code, "transport error must not write a terminal response")
	require.Empty(t, rec.Body.String())
}

func TestGatewayService_ForwardAsChatCompletions_TransportErrorReturnsFailoverErrorWithoutWriting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := []byte(`{"model":"claude-3-5-sonnet-latest","stream":false,"messages":[{"role":"user","content":"hello"}]}`)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))

	upstream := &anthropicHTTPUpstreamRecorder{err: errors.New("read tcp: connection reset by peer")}
	svc := newGatewayTransportFailoverTestService(upstream)
	account := newAnthropicAPIKeyAccountForTest()

	_, err := svc.ForwardAsChatCompletions(context.Background(), c, account, body, nil)
	require.Error(t, err)
	var failoverErr *UpstreamFailoverError
	require.True(t, errors.As(err, &failoverErr), "transport error should return UpstreamFailoverError, got: %T", err)
	require.Equal(t, http.StatusBadGateway, failoverErr.StatusCode)
	require.JSONEq(t, anthropicTransportFailoverBody, string(failoverErr.ResponseBody))
	require.Equal(t, http.StatusOK, rec.Code, "transport error must not write a terminal response")
	require.Empty(t, rec.Body.String())
}
