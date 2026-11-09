package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	coderws "github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

const privacyWSFollowUp = `{"type":"response.create","model":"gpt-5.1","input":[{"role":"user","content":[{"type":"input_text","text":"password: abc12345"}]}]}`

func privacyWSRedactHook(t *testing.T) func([]byte) ([]byte, error) {
	t.Helper()
	svc := newPrivacyTestService(t, PrivacyFilterModeRedact, 7)
	return func(payload []byte) ([]byte, error) {
		result, err := svc.Apply(context.Background(), PrivacyFilterInput{
			GroupID: privacyGroup(7), Protocol: ContentModerationProtocolOpenAIResponses, Body: payload,
		})
		return result.Body, err
	}
}

func TestPrivacyWSPassthroughRedactsFollowUpBeforeForwarding(t *testing.T) {
	gin.SetMode(gin.TestMode)
	controlCtx, cancel := context.WithCancelCause(context.Background())
	defer cancel(context.Canceled)

	upstream := newStagedPassthroughConn()
	upstream.Send(`{"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.1","usage":{"input_tokens":1,"output_tokens":1}}}`)

	var observed []byte
	hooks := &OpenAIWSIngressHooks{
		RewriteClientPayload: privacyWSRedactHook(t),
		BeforeRequest: func(_ int, payload []byte, _ string) error {
			observed = append([]byte(nil), payload...)
			return nil
		},
	}
	server, _ := startPassthroughHookRecordingServer(t, controlCtx, newPassthroughLifecycleService(passthroughLifecycleConfig(), upstream), passthroughLifecycleAccount(), hooks)
	defer server.Close()
	clientConn := dialPassthroughLifecycleClient(t, server)
	defer func() { _ = clientConn.CloseNow() }()
	requirePassthroughUpstreamWrite(t, upstream, time.Second)
	_, err := readPassthroughLifecycleFrame(t, clientConn, 3*time.Second)
	require.NoError(t, err)

	writeCtx, cancelWrite := context.WithTimeout(context.Background(), time.Second)
	require.NoError(t, clientConn.Write(writeCtx, coderws.MessageText, []byte(privacyWSFollowUp)))
	cancelWrite()

	forwarded := requirePassthroughUpstreamWrite(t, upstream, time.Second)
	require.NotContains(t, string(forwarded), "abc12345")
	require.Contains(t, gjson.GetBytes(forwarded, "input.0.content.0.text").String(), "[REDACTED:credential]")
	require.NotContains(t, string(observed), "abc12345", "audit hooks must see the redacted frame")
}

func TestPrivacyWSPassthroughRewriteFailureDoesNotForward(t *testing.T) {
	gin.SetMode(gin.TestMode)
	controlCtx, cancel := context.WithCancelCause(context.Background())
	defer cancel(context.Canceled)

	upstream := newStagedPassthroughConn()
	upstream.Send(`{"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.1","usage":{"input_tokens":1,"output_tokens":1}}}`)
	rejection := errors.New("filter failed")
	hooks := &OpenAIWSIngressHooks{
		RewriteClientPayload: func([]byte) ([]byte, error) { return nil, rejection },
	}
	server, serverErr := startPassthroughHookRecordingServer(t, controlCtx, newPassthroughLifecycleService(passthroughLifecycleConfig(), upstream), passthroughLifecycleAccount(), hooks)
	defer server.Close()
	clientConn := dialPassthroughLifecycleClient(t, server)
	defer func() { _ = clientConn.CloseNow() }()
	requirePassthroughUpstreamWrite(t, upstream, time.Second)
	_, err := readPassthroughLifecycleFrame(t, clientConn, 3*time.Second)
	require.NoError(t, err)

	writeCtx, cancelWrite := context.WithTimeout(context.Background(), time.Second)
	require.NoError(t, clientConn.Write(writeCtx, coderws.MessageText, []byte(privacyWSFollowUp)))
	cancelWrite()

	select {
	case payload := <-upstream.writes:
		t.Fatalf("frame was forwarded despite filter failure: %s", payload)
	case <-time.After(100 * time.Millisecond):
	}
	select {
	case err = <-serverErr:
		require.ErrorIs(t, err, rejection)
	case <-time.After(3 * time.Second):
		t.Fatal("ingress did not exit after filter failure")
	}
}

func TestPrivacyWSIngressRedactsFollowUpBeforeForwarding(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{}
	cfg.Security.URLAllowlist.Enabled = false
	cfg.Security.URLAllowlist.AllowInsecureHTTP = true
	cfg.Gateway.OpenAIWS.Enabled = true
	cfg.Gateway.OpenAIWS.OAuthEnabled = true
	cfg.Gateway.OpenAIWS.APIKeyEnabled = true
	cfg.Gateway.OpenAIWS.ResponsesWebsocketsV2 = true
	cfg.Gateway.OpenAIWS.MaxConnsPerAccount = 1
	cfg.Gateway.OpenAIWS.MinIdlePerAccount = 0
	cfg.Gateway.OpenAIWS.MaxIdlePerAccount = 1
	cfg.Gateway.OpenAIWS.QueueLimitPerConn = 8
	cfg.Gateway.OpenAIWS.DialTimeoutSeconds = 3
	cfg.Gateway.OpenAIWS.ReadTimeoutSeconds = 3
	cfg.Gateway.OpenAIWS.WriteTimeoutSeconds = 3

	upstream := &openAIWSCaptureConn{events: [][]byte{
		[]byte(`{"type":"response.completed","response":{"id":"resp_privacy_1","model":"gpt-5.1","usage":{"input_tokens":1,"output_tokens":1}}}`),
		[]byte(`{"type":"response.completed","response":{"id":"resp_privacy_2","model":"gpt-5.1","usage":{"input_tokens":1,"output_tokens":1}}}`),
	}}
	pool := newOpenAIWSConnPool(cfg)
	pool.setClientDialerForTest(&openAIWSQueueDialer{conns: []openAIWSClientConn{upstream}})
	svc := &OpenAIGatewayService{
		cfg:              cfg,
		httpUpstream:     &httpUpstreamRecorder{},
		cache:            &stubGatewayCache{},
		openaiWSResolver: NewOpenAIWSProtocolResolver(cfg),
		toolCorrector:    NewCodexToolCorrector(),
		openaiWSPool:     pool,
	}
	account := &Account{
		ID: 119, Name: "openai-ingress-privacy", Platform: PlatformOpenAI, Type: AccountTypeAPIKey,
		Status: StatusActive, Schedulable: true, Concurrency: 1,
		Credentials: map[string]any{"api_key": "sk-test"},
		Extra:       map[string]any{"responses_websockets_v2_enabled": true},
	}
	hooks := &OpenAIWSIngressHooks{RewriteClientPayload: privacyWSRedactHook(t)}

	serverErr := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := coderws.Accept(w, r, &coderws.AcceptOptions{CompressionMode: coderws.CompressionContextTakeover})
		if err != nil {
			serverErr <- err
			return
		}
		defer func() { _ = conn.CloseNow() }()
		ginCtx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ginCtx.Request = r.Clone(r.Context())
		readCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		_, first, err := conn.Read(readCtx)
		cancel()
		if err != nil {
			serverErr <- err
			return
		}
		serverErr <- svc.ProxyResponsesWebSocketFromClient(r.Context(), ginCtx, conn, account, "sk-test", first, hooks)
	}))
	defer server.Close()

	dialCtx, cancelDial := context.WithTimeout(context.Background(), 3*time.Second)
	client, _, err := coderws.Dial(dialCtx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	cancelDial()
	require.NoError(t, err)
	defer func() { _ = client.CloseNow() }()

	exchange := func(payload string) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		require.NoError(t, client.Write(ctx, coderws.MessageText, []byte(payload)))
		_, _, readErr := client.Read(ctx)
		require.NoError(t, readErr)
	}
	exchange(`{"type":"response.create","model":"gpt-5.1","stream":false}`)
	exchange(privacyWSFollowUp)
	require.NoError(t, client.Close(coderws.StatusNormalClosure, "done"))
	select {
	case err := <-serverErr:
		require.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("ingress did not exit")
	}

	upstream.mu.Lock()
	writes := append([]map[string]any(nil), upstream.writes...)
	upstream.mu.Unlock()
	require.Len(t, writes, 2)
	raw, err := json.Marshal(writes[1])
	require.NoError(t, err)
	require.NotContains(t, string(raw), "abc12345")
	require.Contains(t, string(raw), "[REDACTED:credential]")
}
