package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/privacyfilter"
	"github.com/tidwall/gjson"
)

type privacyRewriteOutput struct {
	body   []byte
	fields int
	counts map[privacyfilter.Category]int
}

type privacyPatch struct {
	start, end  int
	replacement []byte
}

// privacyRewriter edits only the JSON strings it is pointed at and leaves every
// other byte alone. Signatures, encrypted reasoning, base64 media, IDs, tool
// definitions and system prompts therefore reach the upstream unchanged.
type privacyRewriter struct {
	body    []byte
	redact  func(string) privacyfilter.Result
	patches []privacyPatch
	counts  map[privacyfilter.Category]int
	err     error
}

// rewritePrivacyBody redacts the client-supplied text of a request: user messages
// and tool results. Assistant turns are left alone, since thinking blocks are
// signed and everything the model saw here was already redacted.
func rewritePrivacyBody(protocol string, body []byte, redact func(string) privacyfilter.Result) (privacyRewriteOutput, error) {
	if !gjson.ValidBytes(body) {
		return privacyRewriteOutput{}, fmt.Errorf("request body is not valid JSON")
	}
	rewriter := &privacyRewriter{body: body, redact: redact, counts: make(map[privacyfilter.Category]int)}
	switch protocol {
	case ContentModerationProtocolAnthropicMessages:
		rewriter.anthropicMessages(gjson.GetBytes(body, "messages"))
	case ContentModerationProtocolOpenAIChat:
		rewriter.chatMessages(gjson.GetBytes(body, "messages"))
	case ContentModerationProtocolOpenAIResponses:
		rewriter.responsesInput(gjson.GetBytes(body, "input"))
		rewriter.responsesInput(gjson.GetBytes(body, "response.input"))
	case ContentModerationProtocolGemini:
		rewriter.geminiContents(gjson.GetBytes(body, "contents"))
	case PrivacyFilterProtocolEmbeddings:
		rewriter.embeddingsInput(gjson.GetBytes(body, "input"))
	default:
		return privacyRewriteOutput{}, fmt.Errorf("unsupported protocol %q", protocol)
	}
	if rewriter.err != nil {
		return privacyRewriteOutput{}, rewriter.err
	}
	return rewriter.finish()
}

// text redacts one JSON string in place.
func (r *privacyRewriter) text(value gjson.Result) {
	if r.err != nil || value.Type != gjson.String || value.Str == "" {
		return
	}
	result := r.redact(value.Str)
	if !result.Changed {
		return
	}
	end := value.Index + len(value.Raw)
	if value.Index <= 0 || end > len(r.body) || string(r.body[value.Index:end]) != value.Raw {
		r.err = fmt.Errorf("could not locate string value in request body")
		return
	}
	encoded, err := encodePrivacyJSONString(result.Text)
	if err != nil {
		r.err = err
		return
	}
	r.patches = append(r.patches, privacyPatch{value.Index, end, encoded})
	for category, count := range result.Counts {
		r.counts[category] += count
	}
}

func encodePrivacyJSONString(text string) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(text); err != nil {
		return nil, fmt.Errorf("encode redacted text: %w", err)
	}
	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

func (r *privacyRewriter) finish() (privacyRewriteOutput, error) {
	output := privacyRewriteOutput{body: r.body, fields: len(r.patches), counts: r.counts}
	if len(r.patches) == 0 {
		return output, nil
	}
	sort.Slice(r.patches, func(i, j int) bool { return r.patches[i].start < r.patches[j].start })

	size := len(r.body)
	for _, patch := range r.patches {
		size += len(patch.replacement) - (patch.end - patch.start)
	}
	rebuilt := make([]byte, 0, size)
	previous := 0
	for _, patch := range r.patches {
		if patch.start < previous {
			return privacyRewriteOutput{}, fmt.Errorf("overlapping redaction patches")
		}
		rebuilt = append(rebuilt, r.body[previous:patch.start]...)
		rebuilt = append(rebuilt, patch.replacement...)
		previous = patch.end
	}
	rebuilt = append(rebuilt, r.body[previous:]...)
	if !gjson.ValidBytes(rebuilt) {
		return privacyRewriteOutput{}, fmt.Errorf("redaction produced invalid JSON")
	}
	output.body = rebuilt
	return output, nil
}

func (r *privacyRewriter) anthropicMessages(messages gjson.Result) {
	if !messages.IsArray() {
		return
	}
	messages.ForEach(func(_, message gjson.Result) bool {
		if message.Get("role").String() == "user" {
			r.anthropicContent(message.Get("content"))
		}
		return r.err == nil
	})
}

func (r *privacyRewriter) anthropicContent(content gjson.Result) {
	if content.Type == gjson.String {
		r.text(content)
		return
	}
	if !content.IsArray() {
		return
	}
	content.ForEach(func(_, block gjson.Result) bool {
		switch block.Get("type").String() {
		case "text":
			r.text(block.Get("text"))
		case "tool_result":
			r.anthropicContent(block.Get("content"))
		case "document":
			if block.Get("source.type").String() == "text" {
				r.text(block.Get("source.data"))
			}
		}
		return r.err == nil
	})
}

func (r *privacyRewriter) chatMessages(messages gjson.Result) {
	if !messages.IsArray() {
		return
	}
	messages.ForEach(func(_, message gjson.Result) bool {
		switch message.Get("role").String() {
		case "user", "tool", "function":
			r.chatContent(message.Get("content"))
		}
		return r.err == nil
	})
}

func (r *privacyRewriter) chatContent(content gjson.Result) {
	if content.Type == gjson.String {
		r.text(content)
		return
	}
	if !content.IsArray() {
		return
	}
	content.ForEach(func(_, part gjson.Result) bool {
		if partType := part.Get("type").String(); partType == "text" || partType == "input_text" {
			r.text(part.Get("text"))
		}
		return r.err == nil
	})
}

func (r *privacyRewriter) responsesInput(input gjson.Result) {
	if input.Type == gjson.String {
		r.text(input)
		return
	}
	if !input.IsArray() {
		return
	}
	input.ForEach(func(_, item gjson.Result) bool {
		itemType := item.Get("type").String()
		switch {
		case strings.HasSuffix(itemType, "_output"):
			r.chatContent(item.Get("output"))
		case item.Get("role").String() == "user":
			r.chatContent(item.Get("content"))
		}
		return r.err == nil
	})
}

func (r *privacyRewriter) geminiContents(contents gjson.Result) {
	if !contents.IsArray() {
		return
	}
	contents.ForEach(func(_, content gjson.Result) bool {
		if content.Get("role").String() == "model" {
			return true
		}
		content.Get("parts").ForEach(func(_, part gjson.Result) bool {
			if !part.Get("thought").Bool() {
				r.text(part.Get("text"))
			}
			r.stringLeaves(part.Get("functionResponse.response"))
			return r.err == nil
		})
		return r.err == nil
	})
}

// stringLeaves redacts every string value in a tool's structured response.
func (r *privacyRewriter) stringLeaves(value gjson.Result) {
	if value.Type == gjson.String {
		r.text(value)
		return
	}
	if !value.IsObject() && !value.IsArray() {
		return
	}
	value.ForEach(func(_, child gjson.Result) bool {
		r.stringLeaves(child)
		return r.err == nil
	})
}

func (r *privacyRewriter) embeddingsInput(input gjson.Result) {
	if input.Type == gjson.String {
		r.text(input)
		return
	}
	if !input.IsArray() {
		return
	}
	input.ForEach(func(_, item gjson.Result) bool {
		r.text(item)
		return r.err == nil
	})
}
