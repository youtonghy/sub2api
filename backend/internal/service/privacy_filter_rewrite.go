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

// privacyTarget is one JSON string to process. detect marks client-supplied
// content that is scanned; other targets are assistant history that only gets
// known values swapped back to their placeholders. jsonText marks strings that
// hold JSON themselves, such as tool call arguments.
type privacyTarget struct {
	value    gjson.Result
	detect   bool
	jsonText bool
}

type privacyRewriteOptions struct {
	detect func(string) []privacyfilter.Match
	// vault switches to restorable placeholders. With a vault the assistant
	// history is processed too: clients receive restored values, so they come
	// back in the next request and must be replaced again.
	vault *privacyfilter.Vault
}

type privacyPatch struct {
	start, end  int
	replacement []byte
}

// privacyCollector gathers the strings to process for one protocol and leaves
// every other byte alone. Signatures, encrypted reasoning, base64 media, IDs,
// tool definitions and system prompts therefore reach the upstream unchanged.
type privacyCollector struct {
	assistant bool
	targets   []privacyTarget
}

func (c *privacyCollector) add(value gjson.Result, detect, jsonText bool) {
	if value.Type == gjson.String && value.Str != "" {
		c.targets = append(c.targets, privacyTarget{value: value, detect: detect, jsonText: jsonText})
	}
}

// rewritePrivacyBody redacts client-supplied text: user messages and tool
// results. Thinking and reasoning are never touched because they are signed and
// are never restored, so they still hold placeholders.
func rewritePrivacyBody(protocol string, body []byte, options privacyRewriteOptions) (privacyRewriteOutput, error) {
	if !gjson.ValidBytes(body) {
		return privacyRewriteOutput{}, fmt.Errorf("request body is not valid JSON")
	}
	collector := &privacyCollector{assistant: options.vault != nil}
	switch protocol {
	case ContentModerationProtocolAnthropicMessages:
		collector.anthropicMessages(gjson.GetBytes(body, "messages"))
	case ContentModerationProtocolOpenAIChat:
		collector.chatMessages(gjson.GetBytes(body, "messages"))
	case ContentModerationProtocolOpenAIResponses:
		collector.responsesInput(gjson.GetBytes(body, "input"))
		collector.responsesInput(gjson.GetBytes(body, "response.input"))
	case ContentModerationProtocolGemini:
		collector.geminiContents(gjson.GetBytes(body, "contents"))
	case PrivacyFilterProtocolEmbeddings:
		collector.embeddingsInput(gjson.GetBytes(body, "input"))
	default:
		return privacyRewriteOutput{}, fmt.Errorf("unsupported protocol %q", protocol)
	}

	counts := make(map[privacyfilter.Category]int)
	texts := make([]string, len(collector.targets))
	for i, target := range collector.targets {
		texts[i] = target.value.Str
		if !target.detect {
			continue
		}
		matches := options.detect(texts[i])
		if len(matches) == 0 {
			continue
		}
		var result privacyfilter.Result
		if options.vault != nil {
			result = options.vault.RedactMatches(texts[i], matches)
		} else {
			result = privacyfilter.Replace(texts[i], matches, func(m privacyfilter.Match, _ string) string {
				return privacyfilter.Placeholder(m.Category)
			})
		}
		texts[i] = result.Text
		for category, count := range result.Counts {
			counts[category] += count
		}
	}
	// Runs after every detection so a value found anywhere in the request is
	// also replaced where it appears without the context that revealed it.
	if options.vault != nil && options.vault.Len() > 0 {
		for i, target := range collector.targets {
			if target.jsonText {
				texts[i], _ = options.vault.ReplaceKnownJSON(texts[i])
			} else {
				texts[i], _ = options.vault.ReplaceKnown(texts[i], target.detect)
			}
		}
	}

	patcher := newJSONPatcher(body)
	for i, target := range collector.targets {
		if texts[i] != target.value.Str {
			patcher.set(target.value, texts[i])
		}
	}
	rebuilt, err := patcher.apply()
	if err != nil {
		return privacyRewriteOutput{}, err
	}
	return privacyRewriteOutput{body: rebuilt, fields: patcher.count(), counts: counts}, nil
}

// jsonPatcher replaces string values in place, located by gjson offsets.
type jsonPatcher struct {
	body    []byte
	patches []privacyPatch
	err     error
}

func newJSONPatcher(body []byte) *jsonPatcher { return &jsonPatcher{body: body} }

func (p *jsonPatcher) count() int { return len(p.patches) }

func (p *jsonPatcher) set(value gjson.Result, text string) {
	if p.err != nil {
		return
	}
	end := value.Index + len(value.Raw)
	if value.Index <= 0 || end > len(p.body) || string(p.body[value.Index:end]) != value.Raw {
		p.err = fmt.Errorf("could not locate string value in JSON body")
		return
	}
	encoded, err := encodePrivacyJSONString(text)
	if err != nil {
		p.err = err
		return
	}
	p.patches = append(p.patches, privacyPatch{value.Index, end, encoded})
}

func (p *jsonPatcher) apply() ([]byte, error) {
	if p.err != nil {
		return nil, p.err
	}
	if len(p.patches) == 0 {
		return p.body, nil
	}
	sort.Slice(p.patches, func(i, j int) bool { return p.patches[i].start < p.patches[j].start })
	size := len(p.body)
	for _, patch := range p.patches {
		size += len(patch.replacement) - (patch.end - patch.start)
	}
	rebuilt := make([]byte, 0, size)
	previous := 0
	for _, patch := range p.patches {
		if patch.start < previous {
			return nil, fmt.Errorf("overlapping JSON patches")
		}
		rebuilt = append(rebuilt, p.body[previous:patch.start]...)
		rebuilt = append(rebuilt, patch.replacement...)
		previous = patch.end
	}
	rebuilt = append(rebuilt, p.body[previous:]...)
	if !gjson.ValidBytes(rebuilt) {
		return nil, fmt.Errorf("patching produced invalid JSON")
	}
	return rebuilt, nil
}

func encodePrivacyJSONString(text string) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(text); err != nil {
		return nil, fmt.Errorf("encode JSON string: %w", err)
	}
	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

// stringLeaves visits every string value of a structured value.
func (c *privacyCollector) stringLeaves(value gjson.Result, detect bool) {
	if value.Type == gjson.String {
		c.add(value, detect, false)
		return
	}
	if !value.IsObject() && !value.IsArray() {
		return
	}
	value.ForEach(func(_, child gjson.Result) bool {
		c.stringLeaves(child, detect)
		return true
	})
}

func (c *privacyCollector) anthropicMessages(messages gjson.Result) {
	messages.ForEach(func(_, message gjson.Result) bool {
		switch message.Get("role").String() {
		case "user":
			c.anthropicContent(message.Get("content"), true)
		case "assistant":
			if c.assistant {
				c.anthropicContent(message.Get("content"), false)
			}
		}
		return true
	})
}

func (c *privacyCollector) anthropicContent(content gjson.Result, detect bool) {
	if content.Type == gjson.String {
		c.add(content, detect, false)
		return
	}
	content.ForEach(func(_, block gjson.Result) bool {
		switch block.Get("type").String() {
		case "text":
			c.add(block.Get("text"), detect, false)
		case "tool_result":
			c.anthropicContent(block.Get("content"), detect)
		case "document":
			if block.Get("source.type").String() == "text" {
				c.add(block.Get("source.data"), detect, false)
			}
		case "tool_use", "server_tool_use":
			if !detect {
				c.stringLeaves(block.Get("input"), false)
			}
		}
		return true
	})
}

func (c *privacyCollector) chatMessages(messages gjson.Result) {
	messages.ForEach(func(_, message gjson.Result) bool {
		switch message.Get("role").String() {
		case "user", "tool", "function":
			c.chatContent(message.Get("content"), true)
		case "assistant":
			if c.assistant {
				c.chatContent(message.Get("content"), false)
				message.Get("tool_calls").ForEach(func(_, call gjson.Result) bool {
					c.add(call.Get("function.arguments"), false, true)
					return true
				})
				c.add(message.Get("function_call.arguments"), false, true)
			}
		}
		return true
	})
}

func (c *privacyCollector) chatContent(content gjson.Result, detect bool) {
	if content.Type == gjson.String {
		c.add(content, detect, false)
		return
	}
	content.ForEach(func(_, part gjson.Result) bool {
		switch part.Get("type").String() {
		case "text", "input_text", "output_text":
			c.add(part.Get("text"), detect, false)
		}
		return true
	})
}

func (c *privacyCollector) responsesInput(input gjson.Result) {
	if input.Type == gjson.String {
		c.add(input, true, false)
		return
	}
	input.ForEach(func(_, item gjson.Result) bool {
		itemType := item.Get("type").String()
		switch {
		case strings.HasSuffix(itemType, "_output"):
			c.chatContent(item.Get("output"), true)
		case item.Get("role").String() == "user":
			c.chatContent(item.Get("content"), true)
		case !c.assistant:
		case item.Get("role").String() == "assistant":
			c.chatContent(item.Get("content"), false)
		case itemType == "function_call":
			c.add(item.Get("arguments"), false, true)
		case itemType == "custom_tool_call":
			c.add(item.Get("input"), false, false)
		}
		return true
	})
}

func (c *privacyCollector) geminiContents(contents gjson.Result) {
	contents.ForEach(func(_, content gjson.Result) bool {
		detect := content.Get("role").String() != "model"
		if !detect && !c.assistant {
			return true
		}
		content.Get("parts").ForEach(func(_, part gjson.Result) bool {
			if part.Get("thought").Bool() {
				return true
			}
			c.add(part.Get("text"), detect, false)
			if detect {
				c.stringLeaves(part.Get("functionResponse.response"), true)
			} else {
				c.stringLeaves(part.Get("functionCall.args"), false)
			}
			return true
		})
		return true
	})
}

func (c *privacyCollector) embeddingsInput(input gjson.Result) {
	if input.Type == gjson.String {
		c.add(input, true, false)
		return
	}
	input.ForEach(func(_, item gjson.Result) bool {
		c.add(item, true, false)
		return true
	})
}
