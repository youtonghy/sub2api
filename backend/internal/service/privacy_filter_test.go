package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/privacyfilter"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

const (
	privacyTestSecretText = "my password: abc12345 and card 4111111111111111"
	privacyTestSignature  = "EqQBCgIYAhIMabc+def/ghi=="
	privacyTestImage      = "iVBORw0KGgoAAAANSUhEUgAAA4111111111111111QWxhZGRpbjpvcGVuIHNlc2FtZQ"
)

type privacySettingRepoStub struct {
	SettingRepository
	value string
	err   error
}

func (s *privacySettingRepoStub) GetValue(context.Context, string) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	if s.value == "" {
		return "", ErrSettingNotFound
	}
	return s.value, nil
}

func (s *privacySettingRepoStub) Set(_ context.Context, _ string, value string) error {
	s.value = value
	return nil
}

func newPrivacyTestService(t *testing.T, mode string, groups ...int64) *PrivacyFilterService {
	t.Helper()
	svc := NewPrivacyFilterService(&privacySettingRepoStub{}, nil)
	_, err := svc.UpdateConfig(context.Background(), PrivacyFilterConfig{
		Mode: mode, GroupIDs: groups, Categories: defaultPrivacyFilterCategories(),
	})
	require.NoError(t, err)
	return svc
}

func privacyGroup(id int64) *int64 { return &id }

func applyPrivacyRedact(t *testing.T, protocol, body string) string {
	t.Helper()
	svc := newPrivacyTestService(t, PrivacyFilterModeRedact, 7)
	result, err := svc.Apply(context.Background(), PrivacyFilterInput{GroupID: privacyGroup(7), Protocol: protocol, Body: []byte(body)})
	require.NoError(t, err)
	require.True(t, gjson.ValidBytes(result.Body))
	return string(result.Body)
}

func requirePrivacyRedacted(t *testing.T, body, path string) {
	t.Helper()
	value := gjson.Get(body, path).String()
	require.NotContains(t, value, "abc12345", path)
	require.NotContains(t, value, "4111111111111111", path)
	require.Contains(t, value, "[REDACTED:credential]", path)
	require.Contains(t, value, "[REDACTED:financial]", path)
}

func privacyQuote(t *testing.T, text string) string {
	t.Helper()
	raw, err := json.Marshal(text)
	require.NoError(t, err)
	return string(raw)
}

func TestPrivacyRewriteAnthropic(t *testing.T) {
	secret := privacyQuote(t, privacyTestSecretText)
	body := `{"model":"claude","system":[{"type":"text","text":` + secret + `}],"messages":[
{"role":"user","content":` + secret + `},
{"role":"assistant","content":[{"type":"thinking","thinking":` + secret + `,"signature":"` + privacyTestSignature + `"},{"type":"text","text":` + secret + `},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"note":` + secret + `}}]},
{"role":"user","content":[
 {"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":` + secret + `},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"` + privacyTestImage + `"}}]},
 {"type":"tool_result","tool_use_id":"toolu_2","content":` + secret + `},
 {"type":"text","text":` + secret + `,"cache_control":{"type":"ephemeral"}},
 {"type":"document","source":{"type":"text","media_type":"text/plain","data":` + secret + `}}
]}]}`
	out := applyPrivacyRedact(t, ContentModerationProtocolAnthropicMessages, body)

	requirePrivacyRedacted(t, out, "messages.0.content")
	requirePrivacyRedacted(t, out, "messages.2.content.0.content.0.text")
	requirePrivacyRedacted(t, out, "messages.2.content.1.content")
	requirePrivacyRedacted(t, out, "messages.2.content.2.text")
	requirePrivacyRedacted(t, out, "messages.2.content.3.source.data")

	require.Equal(t, privacyTestSignature, gjson.Get(out, "messages.1.content.0.signature").String())
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "messages.1.content.0.thinking").String(), "signed thinking must not change")
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "messages.1.content.2.input.note").String())
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "system.0.text").String(), "system prompts are not client data")
	require.Equal(t, privacyTestImage, gjson.Get(out, "messages.2.content.0.content.1.source.data").String())
	require.Equal(t, "ephemeral", gjson.Get(out, "messages.2.content.2.cache_control.type").String())
}

func TestPrivacyRewritePreservesEveryOtherByte(t *testing.T) {
	secret := privacyQuote(t, privacyTestSecretText)
	prefix := `{ "z_first" : 1,  "messages":[ {"role":"user",  "content":`
	suffix := ` } ],  "a_last":"<&>é" }`
	out := applyPrivacyRedact(t, ContentModerationProtocolAnthropicMessages, prefix+secret+suffix)
	require.True(t, strings.HasPrefix(out, prefix))
	require.True(t, strings.HasSuffix(out, suffix))
}

func TestPrivacyRewriteUnescapesBeforeScanning(t *testing.T) {
	body := `{"messages":[{"role":"user","content":"line\npassword: abc12345\t\"quoted\" 你好"}]}`
	out := applyPrivacyRedact(t, ContentModerationProtocolAnthropicMessages, body)
	value := gjson.Get(out, "messages.0.content").String()
	require.NotContains(t, value, "abc12345")
	require.Contains(t, value, "\"quoted\" 你好")
}

func TestPrivacyRewriteOpenAIChat(t *testing.T) {
	secret := privacyQuote(t, privacyTestSecretText)
	body := `{"messages":[{"role":"system","content":` + secret + `},{"role":"user","content":[{"type":"text","text":` + secret + `},{"type":"image_url","image_url":{"url":"data:image/png;base64,` + privacyTestImage + `"}}]},{"role":"assistant","content":` + secret + `,"tool_calls":[{"id":"c1","function":{"name":"f","arguments":"{}"}}]},{"role":"tool","tool_call_id":"c1","content":` + secret + `}]}`
	out := applyPrivacyRedact(t, ContentModerationProtocolOpenAIChat, body)
	requirePrivacyRedacted(t, out, "messages.1.content.0.text")
	requirePrivacyRedacted(t, out, "messages.3.content")
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "messages.0.content").String())
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "messages.2.content").String())
	require.Contains(t, gjson.Get(out, "messages.1.content.1.image_url.url").String(), privacyTestImage)
}

func TestPrivacyRewriteResponses(t *testing.T) {
	secret := privacyQuote(t, privacyTestSecretText)
	body := `{"instructions":` + secret + `,"input":[{"role":"user","content":[{"type":"input_text","text":` + secret + `}]},{"type":"reasoning","encrypted_content":"` + privacyTestImage + `","summary":[]},{"type":"function_call","call_id":"c1","name":"f","arguments":` + secret + `},{"type":"function_call_output","call_id":"c1","output":` + secret + `},{"type":"custom_tool_call_output","call_id":"c2","output":[{"type":"input_text","text":` + secret + `}]}]}`
	out := applyPrivacyRedact(t, ContentModerationProtocolOpenAIResponses, body)
	requirePrivacyRedacted(t, out, "input.0.content.0.text")
	requirePrivacyRedacted(t, out, "input.3.output")
	requirePrivacyRedacted(t, out, "input.4.output.0.text")
	require.Equal(t, privacyTestImage, gjson.Get(out, "input.1.encrypted_content").String())
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "instructions").String())
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "input.2.arguments").String())

	stringInput := applyPrivacyRedact(t, ContentModerationProtocolOpenAIResponses, `{"input":`+secret+`}`)
	requirePrivacyRedacted(t, stringInput, "input")
	nested := applyPrivacyRedact(t, ContentModerationProtocolOpenAIResponses, `{"type":"response.create","response":{"input":`+secret+`}}`)
	requirePrivacyRedacted(t, nested, "response.input")
}

func TestPrivacyRewriteGemini(t *testing.T) {
	secret := privacyQuote(t, privacyTestSecretText)
	body := `{"systemInstruction":{"parts":[{"text":` + secret + `}]},"contents":[{"role":"user","parts":[{"text":` + secret + `},{"inlineData":{"mimeType":"image/png","data":"` + privacyTestImage + `"}}]},{"role":"model","parts":[{"text":` + secret + `,"thoughtSignature":"` + privacyTestSignature + `"}]},{"role":"function","parts":[{"functionResponse":{"name":"f","response":{"stdout":` + secret + `,"nested":[{"v":` + secret + `}],"code":0}}}]},{"parts":[{"text":` + secret + `}]}]}`
	out := applyPrivacyRedact(t, ContentModerationProtocolGemini, body)
	requirePrivacyRedacted(t, out, "contents.0.parts.0.text")
	requirePrivacyRedacted(t, out, "contents.2.parts.0.functionResponse.response.stdout")
	requirePrivacyRedacted(t, out, "contents.2.parts.0.functionResponse.response.nested.0.v")
	requirePrivacyRedacted(t, out, "contents.3.parts.0.text")
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "contents.1.parts.0.text").String())
	require.Equal(t, privacyTestSignature, gjson.Get(out, "contents.1.parts.0.thoughtSignature").String())
	require.Equal(t, privacyTestImage, gjson.Get(out, "contents.0.parts.1.inlineData.data").String())
	require.Equal(t, privacyTestSecretText, gjson.Get(out, "systemInstruction.parts.0.text").String())
}

func TestPrivacyRewriteEmbeddings(t *testing.T) {
	secret := privacyQuote(t, privacyTestSecretText)
	out := applyPrivacyRedact(t, PrivacyFilterProtocolEmbeddings, `{"input":[`+secret+`,"ok"]}`)
	requirePrivacyRedacted(t, out, "input.0")
	tokens := applyPrivacyRedact(t, PrivacyFilterProtocolEmbeddings, `{"input":[1,2,3]}`)
	require.Equal(t, `{"input":[1,2,3]}`, tokens)
}

func TestPrivacyRewriteIsStableAcrossTurns(t *testing.T) {
	body := `{"messages":[{"role":"user","content":` + privacyQuote(t, privacyTestSecretText) + `}]}`
	once := applyPrivacyRedact(t, ContentModerationProtocolAnthropicMessages, body)
	require.Equal(t, once, applyPrivacyRedact(t, ContentModerationProtocolAnthropicMessages, once))
}

func TestPrivacyApplyScope(t *testing.T) {
	body := []byte(`{"messages":[{"role":"user","content":` + privacyQuote(t, privacyTestSecretText) + `}]}`)
	input := func(group *int64) PrivacyFilterInput {
		return PrivacyFilterInput{GroupID: group, Protocol: ContentModerationProtocolAnthropicMessages, Body: body}
	}
	ctx := context.Background()

	t.Run("off by default", func(t *testing.T) {
		svc := NewPrivacyFilterService(&privacySettingRepoStub{}, nil)
		result, err := svc.Apply(ctx, input(privacyGroup(7)))
		require.NoError(t, err)
		require.Equal(t, body, result.Body)
		require.Zero(t, svc.GetStatus().ScannedRequests)
	})
	t.Run("nil service", func(t *testing.T) {
		var svc *PrivacyFilterService
		result, err := svc.Apply(ctx, input(privacyGroup(7)))
		require.NoError(t, err)
		require.Equal(t, body, result.Body)
	})
	t.Run("group not listed", func(t *testing.T) {
		result, err := newPrivacyTestService(t, PrivacyFilterModeRedact, 8).Apply(ctx, input(privacyGroup(7)))
		require.NoError(t, err)
		require.Equal(t, body, result.Body)
	})
	t.Run("no group", func(t *testing.T) {
		result, err := newPrivacyTestService(t, PrivacyFilterModeRedact, 7).Apply(ctx, input(nil))
		require.NoError(t, err)
		require.Equal(t, body, result.Body)
	})
	t.Run("observe counts without changing", func(t *testing.T) {
		svc := newPrivacyTestService(t, PrivacyFilterModeObserve, 7)
		result, err := svc.Apply(ctx, input(privacyGroup(7)))
		require.NoError(t, err)
		require.Equal(t, body, result.Body)
		require.False(t, result.Changed)
		require.Equal(t, 1, result.Counts["credential"])
		status := svc.GetStatus()
		require.EqualValues(t, 1, status.HitRequests)
		require.Zero(t, status.RedactedRequests)
		require.EqualValues(t, 1, status.CategoryCounts["financial"])
	})
	t.Run("redact changes and counts", func(t *testing.T) {
		svc := newPrivacyTestService(t, PrivacyFilterModeRedact, 7)
		result, err := svc.Apply(ctx, input(privacyGroup(7)))
		require.NoError(t, err)
		require.True(t, result.Changed)
		require.NotContains(t, string(result.Body), "abc12345")
		require.EqualValues(t, 1, svc.GetStatus().RedactedRequests)
	})
	t.Run("category switches", func(t *testing.T) {
		svc := NewPrivacyFilterService(&privacySettingRepoStub{}, nil)
		_, err := svc.UpdateConfig(ctx, PrivacyFilterConfig{Mode: PrivacyFilterModeRedact, GroupIDs: []int64{7}, Categories: []string{"financial"}})
		require.NoError(t, err)
		result, err := svc.Apply(ctx, input(privacyGroup(7)))
		require.NoError(t, err)
		require.Contains(t, string(result.Body), "abc12345")
		require.NotContains(t, string(result.Body), "4111111111111111")
	})
}

func TestPrivacyApplyFailsClosed(t *testing.T) {
	ctx := context.Background()
	body := []byte(`{"messages":[{"role":"user","content":"hello"}]}`)
	validInput := PrivacyFilterInput{GroupID: privacyGroup(7), Protocol: ContentModerationProtocolAnthropicMessages, Body: body}

	t.Run("invalid json rejected in redact", func(t *testing.T) {
		svc := newPrivacyTestService(t, PrivacyFilterModeRedact, 7)
		_, err := svc.Apply(ctx, PrivacyFilterInput{GroupID: privacyGroup(7), Protocol: ContentModerationProtocolAnthropicMessages, Body: []byte(`{"messages":[`)})
		require.ErrorIs(t, err, ErrPrivacyFilterFailed)
		require.EqualValues(t, 1, svc.GetStatus().FailedRequests)
	})
	t.Run("detector panic rejected in redact", func(t *testing.T) {
		svc := newPrivacyTestService(t, PrivacyFilterModeRedact, 7)
		svc.detector = func() (*privacyfilter.Detector, error) { panic("boom") }
		_, err := svc.Apply(ctx, validInput)
		require.ErrorIs(t, err, ErrPrivacyFilterFailed)
	})
	t.Run("rule load failure rejected in redact", func(t *testing.T) {
		svc := newPrivacyTestService(t, PrivacyFilterModeRedact, 7)
		svc.detector = func() (*privacyfilter.Detector, error) { return nil, errors.New("bad rules") }
		_, err := svc.Apply(ctx, validInput)
		require.ErrorIs(t, err, ErrPrivacyFilterFailed)
	})
	t.Run("observe never blocks", func(t *testing.T) {
		svc := newPrivacyTestService(t, PrivacyFilterModeObserve, 7)
		svc.detector = func() (*privacyfilter.Detector, error) { panic("boom") }
		result, err := svc.Apply(ctx, validInput)
		require.NoError(t, err)
		require.Equal(t, body, result.Body)
		require.EqualValues(t, 1, svc.GetStatus().FailedRequests)
	})
	t.Run("unreadable config with no snapshot rejected", func(t *testing.T) {
		svc := NewPrivacyFilterService(&privacySettingRepoStub{err: errors.New("db down")}, nil)
		_, err := svc.Apply(ctx, validInput)
		require.ErrorIs(t, err, ErrPrivacyFilterFailed)
	})
	t.Run("settings outage keeps last snapshot", func(t *testing.T) {
		repo := &privacySettingRepoStub{}
		svc := NewPrivacyFilterService(repo, nil)
		_, err := svc.UpdateConfig(ctx, PrivacyFilterConfig{Mode: PrivacyFilterModeRedact, GroupIDs: []int64{7}, Categories: defaultPrivacyFilterCategories()})
		require.NoError(t, err)
		stale := *svc.snapshot.Load()
		stale.loadedAt = time.Now().Add(-time.Hour)
		svc.snapshot.Store(&stale)
		repo.err = errors.New("db down")

		secretBody := []byte(`{"messages":[{"role":"user","content":"password: abc12345"}]}`)
		result, err := svc.Apply(ctx, PrivacyFilterInput{GroupID: privacyGroup(7), Protocol: ContentModerationProtocolAnthropicMessages, Body: secretBody})
		require.NoError(t, err)
		require.NotContains(t, string(result.Body), "abc12345")
	})
}

func TestPrivacyConfig(t *testing.T) {
	ctx := context.Background()
	svc := NewPrivacyFilterService(&privacySettingRepoStub{}, nil)

	config, err := svc.GetConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, PrivacyFilterModeOff, config.Mode)
	require.ElementsMatch(t, []string{"private_key", "credential", "financial", "identity", "proxy"}, config.Categories)
	require.Empty(t, config.GroupIDs)

	_, err = svc.UpdateConfig(ctx, PrivacyFilterConfig{Mode: "bogus"})
	require.Error(t, err)
	_, err = svc.UpdateConfig(ctx, PrivacyFilterConfig{Mode: PrivacyFilterModeOff, Categories: []string{"bogus"}})
	require.Error(t, err)
	_, err = svc.UpdateConfig(ctx, PrivacyFilterConfig{Mode: PrivacyFilterModeOff, GroupIDs: []int64{-1}})
	require.Error(t, err)

	omitted, err := svc.UpdateConfig(ctx, PrivacyFilterConfig{Mode: PrivacyFilterModeOff})
	require.NoError(t, err)
	require.Equal(t, defaultPrivacyFilterCategories(), omitted.Categories, "omitting categories keeps the defaults")

	saved, err := svc.UpdateConfig(ctx, PrivacyFilterConfig{Mode: PrivacyFilterModeObserve, GroupIDs: []int64{9, 3}, Categories: []string{}})
	require.NoError(t, err)
	require.Equal(t, []int64{3, 9}, saved.GroupIDs)

	reloaded, err := svc.GetConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, saved, reloaded)
	require.Empty(t, reloaded.Categories, "an explicit empty selection must not fall back to defaults")
}

func TestPrivacyLargeBlockUsesCache(t *testing.T) {
	svc := newPrivacyTestService(t, PrivacyFilterModeRedact, 7)
	block := privacyTestSecretText + strings.Repeat(" padding", 200)
	body := []byte(`{"messages":[{"role":"user","content":"` + block + `"}]}`)
	input := PrivacyFilterInput{GroupID: privacyGroup(7), Protocol: ContentModerationProtocolAnthropicMessages, Body: body}

	first, err := svc.Apply(context.Background(), input)
	require.NoError(t, err)
	svc.blockCache().Wait()
	second, err := svc.Apply(context.Background(), input)
	require.NoError(t, err)
	require.Equal(t, first.Body, second.Body)
	require.Equal(t, first.Counts, second.Counts)
}
