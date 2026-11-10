package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/pkg/privacyfilter"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

const (
	restoreSecret = `S3cret"Pa55\x`
	restoreCard   = "4111111111111111"
)

func restoreTestVault(t *testing.T) (*privacyfilter.Vault, string, string) {
	t.Helper()
	v := privacyfilter.NewVault([]byte("restore-test"))
	return v, v.Token(privacyfilter.CategoryCredential, restoreSecret), v.Token(privacyfilter.CategoryFinancial, restoreCard)
}

func jsonText(t *testing.T, s string) string {
	t.Helper()
	raw, err := json.Marshal(s)
	require.NoError(t, err)
	return string(raw)
}

// runThroughWriter writes body to a restore writer in two pieces split at cut.
func runThroughWriter(t *testing.T, protocol string, vault *privacyfilter.Vault, contentType string, status int, body string, cut int) (*httptest.ResponseRecorder, *gin.Context) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	InstallPrivacyRestoreWriter(c, nil, protocol, vault)
	c.Writer.Header().Set("Content-Type", contentType)
	c.Writer.WriteHeader(status)
	_, err := c.Writer.Write([]byte(body[:cut]))
	require.NoError(t, err)
	c.Writer.Flush()
	_, err = c.Writer.Write([]byte(body[cut:]))
	require.NoError(t, err)
	FinishPrivacyRestore(c)
	return recorder, c
}

type sseEvent struct {
	name string
	data string
}

func parseSSE(t *testing.T, body string) []sseEvent {
	t.Helper()
	var events []sseEvent
	for _, block := range strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n\n") {
		var event sseEvent
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "event: ") {
				event.name = strings.TrimPrefix(line, "event: ")
			}
			if strings.HasPrefix(line, "data: ") {
				event.data = strings.TrimPrefix(line, "data: ")
			}
		}
		if event.data != "" {
			events = append(events, event)
		}
	}
	return events
}

func sseBody(events ...string) string {
	var b strings.Builder
	for _, event := range events {
		b.WriteString(event)
		b.WriteString("\n\n")
	}
	return b.String()
}

// splitDelta breaks text into deltas of size n so placeholders straddle events.
func splitDelta(text string, n int) []string {
	var parts []string
	for len(text) > n {
		parts = append(parts, text[:n])
		text = text[n:]
	}
	return append(parts, text)
}

func TestPrivacyRestoreAnthropicStream(t *testing.T) {
	vault, secretToken, cardToken := restoreTestVault(t)
	text := "Use " + secretToken + " and card " + cardToken + " [done]"
	argsJSON := `{"command":"login --password ` + secretToken + `"}`
	thinking := "thinking keeps " + secretToken

	for _, size := range []int{1, 3, 7, 40} {
		events := []string{
			`event: message_start` + "\ndata: " + `{"type":"message_start","message":{"id":"m","content":[]}}`,
			`event: content_block_start` + "\ndata: " + `{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`,
			`event: content_block_delta` + "\ndata: " + `{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":` + jsonText(t, thinking) + `}}`,
			`event: content_block_stop` + "\ndata: " + `{"type":"content_block_stop","index":0}`,
			`event: content_block_start` + "\ndata: " + `{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
		}
		for _, piece := range splitDelta(text, size) {
			events = append(events, "event: content_block_delta\ndata: "+`{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":`+jsonText(t, piece)+`}}`)
		}
		events = append(events, "event: content_block_stop\ndata: "+`{"type":"content_block_stop","index":1}`,
			"event: content_block_start\ndata: "+`{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"t","name":"Bash","input":{}}}`)
		for _, piece := range splitDelta(argsJSON, size) {
			events = append(events, "event: content_block_delta\ndata: "+`{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":`+jsonText(t, piece)+`}}`)
		}
		events = append(events, "event: content_block_stop\ndata: "+`{"type":"content_block_stop","index":2}`,
			"event: message_stop\ndata: "+`{"type":"message_stop"}`)
		body := sseBody(events...)

		for _, cut := range []int{0, len(body) / 3, len(body) / 2, len(body)} {
			recorder, _ := runThroughWriter(t, ContentModerationProtocolAnthropicMessages, vault, "text/event-stream", http.StatusOK, body, cut)
			var gotText, gotArgs, gotThinking strings.Builder
			for _, event := range parseSSE(t, recorder.Body.String()) {
				require.True(t, gjson.Valid(event.data), event.data)
				require.Equal(t, gjson.Get(event.data, "type").String(), event.name)
				delta := gjson.Get(event.data, "delta")
				switch gjson.Get(event.data, "index").Int() {
				case 0:
					gotThinking.WriteString(delta.Get("thinking").String())
				case 1:
					gotText.WriteString(delta.Get("text").String())
				case 2:
					gotArgs.WriteString(delta.Get("partial_json").String())
				}
			}
			require.Equal(t, "Use "+restoreSecret+" and card "+restoreCard+" [done]", gotText.String(), "size %d cut %d", size, cut)
			require.Equal(t, restoreSecret, gjson.Get(gotArgs.String(), "command").String()[len("login --password "):])
			require.Equal(t, thinking, gotThinking.String(), "thinking is signed and stays redacted")
		}
	}
}

func TestPrivacyRestoreAnthropicJSON(t *testing.T) {
	vault, secretToken, _ := restoreTestVault(t)
	body := `{"id":"m","content":[{"type":"thinking","thinking":"` + secretToken + `","signature":"sig"},{"type":"text","text":"key ` + secretToken + `"},{"type":"tool_use","id":"t","name":"Bash","input":{"cmd":"echo ` + secretToken + `","n":1}}]}`
	recorder, c := runThroughWriter(t, ContentModerationProtocolAnthropicMessages, vault, "application/json", http.StatusOK, body, 20)
	out := recorder.Body.String()
	require.Equal(t, "key "+restoreSecret, gjson.Get(out, "content.1.text").String())
	require.Equal(t, "echo "+restoreSecret, gjson.Get(out, "content.2.input.cmd").String())
	require.Equal(t, secretToken, gjson.Get(out, "content.0.thinking").String())
	require.Equal(t, len(out), mustAtoi(t, recorder.Header().Get("Content-Length")))
	require.True(t, c.Writer.Written())
}

func mustAtoi(t *testing.T, s string) int {
	t.Helper()
	var n int
	require.NoError(t, json.Unmarshal([]byte(s), &n))
	return n
}

func TestPrivacyRestoreChatStream(t *testing.T) {
	vault, secretToken, _ := restoreTestVault(t)
	text := "pwd=" + secretToken
	args := `{"p":"` + secretToken + `"}`
	var events []string
	for _, piece := range splitDelta(text, 5) {
		events = append(events, "data: "+`{"id":"c1","created":1,"model":"m","choices":[{"index":0,"delta":{"content":`+jsonText(t, piece)+`},"finish_reason":null}]}`)
	}
	for _, piece := range splitDelta(args, 6) {
		events = append(events, "data: "+`{"id":"c1","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":`+jsonText(t, piece)+`}}]},"finish_reason":null}]}`)
	}
	// The stream ends mid-placeholder to exercise the release on finish_reason.
	events = append(events, "data: "+`{"id":"c1","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"[RED"},"finish_reason":null}]}`,
		"data: "+`{"id":"c1","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
		"data: [DONE]")
	body := sseBody(events...)
	for cut := 0; cut <= len(body); cut += 37 {
		recorder, _ := runThroughWriter(t, ContentModerationProtocolOpenAIChat, vault, "text/event-stream; charset=utf-8", http.StatusOK, body, cut)
		var content, gotArgs strings.Builder
		parsed := parseSSE(t, recorder.Body.String())
		for _, event := range parsed {
			if event.data == "[DONE]" {
				continue
			}
			require.Equal(t, "c1", gjson.Get(event.data, "id").String())
			content.WriteString(gjson.Get(event.data, "choices.0.delta.content").String())
			gotArgs.WriteString(gjson.Get(event.data, "choices.0.delta.tool_calls.0.function.arguments").String())
		}
		require.Equal(t, "pwd="+restoreSecret+"[RED", content.String())
		require.Equal(t, restoreSecret, gjson.Get(gotArgs.String(), "p").String())
		require.Equal(t, "[DONE]", parsed[len(parsed)-1].data)
	}
}

func TestPrivacyRestoreChatJSON(t *testing.T) {
	vault, secretToken, _ := restoreTestVault(t)
	body := `{"choices":[{"index":0,"message":{"role":"assistant","content":"x ` + secretToken + `","tool_calls":[{"id":"1","function":{"name":"f","arguments":` + jsonText(t, `{"p":"`+secretToken+`"}`) + `}}]}}]}`
	recorder, _ := runThroughWriter(t, ContentModerationProtocolOpenAIChat, vault, "application/json", http.StatusOK, body, 5)
	out := recorder.Body.String()
	require.Equal(t, "x "+restoreSecret, gjson.Get(out, "choices.0.message.content").String())
	require.Equal(t, restoreSecret, gjson.Get(gjson.Get(out, "choices.0.message.tool_calls.0.function.arguments").String(), "p").String())
}

func responsesStreamEvents(t *testing.T, secretToken string, size int) []string {
	t.Helper()
	text := "value " + secretToken
	args := `{"p":"` + secretToken + `"}`
	event := func(payload string) string {
		return "event: " + gjson.Get(payload, "type").String() + "\ndata: " + payload
	}
	events := []string{event(`{"type":"response.output_item.added","output_index":0,"item":{"id":"msg","type":"message","content":[]}}`)}
	for _, piece := range splitDelta(text, size) {
		events = append(events, event(`{"type":"response.output_text.delta","item_id":"msg","output_index":0,"content_index":0,"delta":`+jsonText(t, piece)+`}`))
	}
	events = append(events, event(`{"type":"response.output_text.delta","item_id":"msg","output_index":0,"content_index":0,"delta":" [REDACTED:cre"}`),
		event(`{"type":"response.output_text.done","item_id":"msg","output_index":0,"content_index":0,"text":`+jsonText(t, text+" [REDACTED:cre")+`}`))
	for _, piece := range splitDelta(args, size) {
		events = append(events, event(`{"type":"response.function_call_arguments.delta","item_id":"fc","output_index":1,"delta":`+jsonText(t, piece)+`}`))
	}
	events = append(events,
		event(`{"type":"response.function_call_arguments.done","item_id":"fc","output_index":1,"arguments":`+jsonText(t, args)+`}`),
		event(`{"type":"response.output_item.done","output_index":0,"item":{"id":"msg","type":"message","content":[{"type":"output_text","text":`+jsonText(t, text)+`}]}}`),
		event(`{"type":"response.completed","response":{"output":[{"type":"reasoning","summary":[{"type":"summary_text","text":`+jsonText(t, secretToken)+`}]},{"type":"message","content":[{"type":"output_text","text":`+jsonText(t, text)+`}]},{"type":"function_call","arguments":`+jsonText(t, args)+`}]}}`))
	return events
}

func checkResponsesEvents(t *testing.T, secretToken string, events []sseEvent) {
	t.Helper()
	var text, args strings.Builder
	for _, event := range events {
		require.True(t, gjson.Valid(event.data), event.data)
		if event.name != "" {
			require.Equal(t, gjson.Get(event.data, "type").String(), event.name)
		}
		switch gjson.Get(event.data, "type").String() {
		case "response.output_text.delta":
			text.WriteString(gjson.Get(event.data, "delta").String())
		case "response.function_call_arguments.delta":
			args.WriteString(gjson.Get(event.data, "delta").String())
		case "response.output_text.done":
			require.Equal(t, "value "+restoreSecret+" [REDACTED:cre", gjson.Get(event.data, "text").String())
		case "response.function_call_arguments.done":
			require.Equal(t, restoreSecret, gjson.Get(gjson.Get(event.data, "arguments").String(), "p").String())
		case "response.output_item.done":
			require.Equal(t, "value "+restoreSecret, gjson.Get(event.data, "item.content.0.text").String())
		case "response.completed":
			require.Equal(t, secretToken, gjson.Get(event.data, "response.output.0.summary.0.text").String())
			require.Equal(t, "value "+restoreSecret, gjson.Get(event.data, "response.output.1.content.0.text").String())
			require.Equal(t, restoreSecret, gjson.Get(gjson.Get(event.data, "response.output.2.arguments").String(), "p").String())
		}
	}
	require.Equal(t, "value "+restoreSecret+" [REDACTED:cre", text.String())
	require.Equal(t, restoreSecret, gjson.Get(args.String(), "p").String())
}

func TestPrivacyRestoreResponsesStream(t *testing.T) {
	vault, secretToken, _ := restoreTestVault(t)
	for _, size := range []int{1, 4, 9} {
		body := sseBody(responsesStreamEvents(t, secretToken, size)...)
		recorder, _ := runThroughWriter(t, ContentModerationProtocolOpenAIResponses, vault, "text/event-stream", http.StatusOK, body, len(body)/2)
		checkResponsesEvents(t, secretToken, parseSSE(t, recorder.Body.String()))
	}
}

func TestPrivacyRestoreResponsesWebSocketFrames(t *testing.T) {
	vault, secretToken, _ := restoreTestVault(t)
	restorer := NewPrivacyResponseRestorer(ContentModerationProtocolOpenAIResponses, vault)
	var events []sseEvent
	for _, raw := range responsesStreamEvents(t, secretToken, 3) {
		frame := raw[strings.Index(raw, "data: ")+len("data: "):]
		for _, out := range restorer.RestorePrivacyFrames([]byte(frame)) {
			events = append(events, sseEvent{data: string(out)})
		}
	}
	checkResponsesEvents(t, secretToken, events)
}

func TestPrivacyRestoreGemini(t *testing.T) {
	vault, secretToken, _ := restoreTestVault(t)
	text := "ok " + secretToken
	var events []string
	for _, piece := range splitDelta(text, 4) {
		events = append(events, "data: "+`{"candidates":[{"index":0,"content":{"role":"model","parts":[{"text":`+jsonText(t, piece)+`}]}}]}`)
	}
	events = append(events,
		"data: "+`{"candidates":[{"index":0,"content":{"role":"model","parts":[{"text":"thought `+secretToken+`","thought":true},{"functionCall":{"name":"f","args":{"p":"`+secretToken+`"}}},{"text":" [REDACTED"}]},"finishReason":"STOP"}]}`)
	body := strings.ReplaceAll(sseBody(events...), "\n\n", "\r\n\r\n")
	recorder, _ := runThroughWriter(t, ContentModerationProtocolGemini, vault, "text/event-stream", http.StatusOK, body, 11)
	var got strings.Builder
	var args, thought string
	for _, event := range parseSSE(t, recorder.Body.String()) {
		gjson.Get(event.data, "candidates.0.content.parts").ForEach(func(_, part gjson.Result) bool {
			switch {
			case part.Get("thought").Bool():
				thought = part.Get("text").String()
			case part.Get("functionCall").Exists():
				args = part.Get("functionCall.args.p").String()
			default:
				got.WriteString(part.Get("text").String())
			}
			return true
		})
	}
	require.Equal(t, "ok "+restoreSecret+" [REDACTED", got.String())
	require.Equal(t, restoreSecret, args)
	require.Equal(t, "thought "+secretToken, thought)

	wrapped := `[{"response":{"candidates":[{"content":{"parts":[{"text":"a ` + secretToken + `"}]}}]}}]`
	recorder, _ = runThroughWriter(t, ContentModerationProtocolGemini, vault, "application/json", http.StatusOK, wrapped, 3)
	require.Equal(t, "a "+restoreSecret, gjson.Get(recorder.Body.String(), "0.response.candidates.0.content.parts.0.text").String())
}

func TestPrivacyRestoreWriterPassesErrorsAndOtherContent(t *testing.T) {
	vault, secretToken, _ := restoreTestVault(t)
	body := `{"error":{"message":"bad ` + secretToken + `"}}`
	recorder, _ := runThroughWriter(t, ContentModerationProtocolAnthropicMessages, vault, "application/json", http.StatusBadRequest, body, 4)
	require.Equal(t, body, recorder.Body.String(), "error bodies are never restored")

	recorder, _ = runThroughWriter(t, ContentModerationProtocolAnthropicMessages, vault, "image/png", http.StatusOK, secretToken, 4)
	require.Equal(t, secretToken, recorder.Body.String())
}

func TestPrivacyRestoreWriterNotInstalledWithoutValues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	original := c.Writer
	InstallPrivacyRestoreWriter(c, nil, ContentModerationProtocolAnthropicMessages, privacyfilter.NewVault([]byte("k")))
	require.Equal(t, original, c.Writer)
	InstallPrivacyRestoreWriter(c, nil, PrivacyFilterProtocolEmbeddings, nil)
	require.Equal(t, original, c.Writer)
	FinishPrivacyRestore(c)
}

func TestPrivacyRestoreWriterReportsHeldBytesAsWritten(t *testing.T) {
	gin.SetMode(gin.TestMode)
	vault, _, _ := restoreTestVault(t)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	InstallPrivacyRestoreWriter(c, nil, ContentModerationProtocolAnthropicMessages, vault)
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	_, err := c.Writer.Write([]byte(`event: content_block_delta` + "\ndata: " + `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"[REDACT"}}`))
	require.NoError(t, err)
	require.True(t, c.Writer.Written(), "failover must not retry after bytes were handed over")
	require.Positive(t, c.Writer.Size())
	FinishPrivacyRestore(c)
	require.Contains(t, recorder.Body.String(), "[REDACT")
}

// Restored output comes back as history in the next request. Redacting it again
// must reproduce exactly what the upstream produced, or prompt caches and
// signatures break.
func TestPrivacyRestoreRoundTripMatchesUpstream(t *testing.T) {
	svc := newPrivacyTestService(t, PrivacyFilterModeRestore, 7)
	ctx := context.Background()
	apply := func(protocol, body string, vault *privacyfilter.Vault) PrivacyFilterResult {
		result, err := svc.Apply(ctx, PrivacyFilterInput{GroupID: privacyGroup(7), APIKeyID: 42, Protocol: protocol, Body: []byte(body), Vault: vault})
		require.NoError(t, err)
		return result
	}

	t.Run("anthropic", func(t *testing.T) {
		first := apply(ContentModerationProtocolAnthropicMessages, `{"messages":[{"role":"user","content":"my password: abc12345xyz"}]}`, nil)
		require.NotContains(t, string(first.Body), "abc12345xyz")
		token := gjson.GetBytes(first.Body, "messages.0.content").String()[len("my password: "):]

		upstreamText := "Saved " + token + ", done."
		upstreamInput := `{"cmd":"login ` + token + `"}`
		restorer := NewPrivacyResponseRestorer(ContentModerationProtocolAnthropicMessages, first.Vault)
		restored := restorer.RestoreBody([]byte(`{"content":[{"type":"thinking","thinking":"t ` + token + `","signature":"s"},{"type":"text","text":` + jsonText(t, upstreamText) + `},{"type":"tool_use","id":"u","name":"Bash","input":` + upstreamInput + `}]}`))
		require.Contains(t, string(restored), "abc12345xyz")

		next := `{"messages":[{"role":"user","content":"my password: abc12345xyz"},{"role":"assistant","content":` + gjson.GetBytes(restored, "content").Raw + `},{"role":"user","content":"again abc12345xyz"}]}`
		second := apply(ContentModerationProtocolAnthropicMessages, next, nil)
		require.NotContains(t, string(second.Body), "abc12345xyz")
		require.Equal(t, upstreamText, gjson.GetBytes(second.Body, "messages.1.content.1.text").String())
		require.Equal(t, "login "+token, gjson.GetBytes(second.Body, "messages.1.content.2.input.cmd").String())
		require.Equal(t, "t "+token, gjson.GetBytes(second.Body, "messages.1.content.0.thinking").String())
		require.Equal(t, "again "+token, gjson.GetBytes(second.Body, "messages.2.content").String())
		require.Equal(t, gjson.GetBytes(first.Body, "messages.0.content").String(), gjson.GetBytes(second.Body, "messages.0.content").String())
	})

	t.Run("responses", func(t *testing.T) {
		first := apply(ContentModerationProtocolOpenAIResponses, `{"input":[{"role":"user","content":[{"type":"input_text","text":"token: Zx9kLm2QpRt7"}]}]}`, nil)
		token := gjson.GetBytes(first.Body, "input.0.content.0.text").String()[len("token: "):]
		arguments := `{"t":"` + token + `"}`
		restorer := NewPrivacyResponseRestorer(ContentModerationProtocolOpenAIResponses, first.Vault)
		restored := restorer.RestoreBody([]byte(`{"output":[{"type":"function_call","call_id":"c","name":"f","arguments":` + jsonText(t, arguments) + `},{"type":"message","role":"assistant","content":[{"type":"output_text","text":` + jsonText(t, "ok "+token) + `}]}]}`))
		output := gjson.GetBytes(restored, "output").Raw
		next := `{"input":[{"role":"user","content":[{"type":"input_text","text":"token: Zx9kLm2QpRt7"}]},` + output[1:len(output)-1] + `]}`
		second := apply(ContentModerationProtocolOpenAIResponses, next, nil)
		require.NotContains(t, string(second.Body), "Zx9kLm2QpRt7")
		require.Equal(t, arguments, gjson.GetBytes(second.Body, "input.1.arguments").String())
		require.Equal(t, "ok "+token, gjson.GetBytes(second.Body, "input.2.content.0.text").String())
	})

	t.Run("placeholders are stable per api key", func(t *testing.T) {
		body := `{"messages":[{"role":"user","content":"password: abc12345xyz"}]}`
		a := apply(ContentModerationProtocolAnthropicMessages, body, nil)
		b := apply(ContentModerationProtocolAnthropicMessages, body, nil)
		require.Equal(t, a.Body, b.Body)
		other, err := svc.Apply(ctx, PrivacyFilterInput{GroupID: privacyGroup(7), APIKeyID: 43, Protocol: ContentModerationProtocolAnthropicMessages, Body: []byte(body)})
		require.NoError(t, err)
		require.NotEqual(t, a.Body, other.Body)
	})
}

func BenchmarkPrivacyRestoreAnthropicStream(b *testing.B) {
	gin.SetMode(gin.TestMode)
	vault := privacyfilter.NewVault([]byte("bench"))
	token := vault.Token(privacyfilter.CategoryCredential, "abc12345")
	event := []byte("event: content_block_delta\ndata: " + `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"some streamed text with ` + token + ` inside"}}` + "\n\n")
	b.SetBytes(int64(len(event)))
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	InstallPrivacyRestoreWriter(c, nil, ContentModerationProtocolAnthropicMessages, vault)
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = c.Writer.Write(event)
		if i%1000 == 0 {
			recorder.Body.Reset()
		}
	}
}
