package service

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/Wei-Shaw/sub2api/internal/pkg/privacyfilter"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// PrivacyEvent is one response event to send to the client. Name is the SSE
// event name and is empty for formats without one.
type PrivacyEvent struct {
	Name string
	Data []byte
}

// PrivacyResponseRestorer puts original values back into a response in the
// client's protocol, whatever protocol the upstream spoke. Text that streams in
// pieces is restored per stream position, holding back a possible partial
// placeholder until the next piece or the end of that position.
//
// Thinking and reasoning are left alone: they are signed by the upstream and
// travel back unchanged, so they must keep their placeholders.
type PrivacyResponseRestorer struct {
	protocol string
	vault    *privacyfilter.Vault

	mu      sync.Mutex
	streams map[string]*privacyResponseStream
	order   []string
	wrapped bool // Gemini responses wrapped as {"response": ...}
}

type privacyResponseStream struct {
	restorer *privacyfilter.StreamRestorer
	jsonText bool
	// position fields used to build an event that releases held-back text
	index, tool          int
	itemID               string
	outputIndex, content gjson.Result
	eventType            string
}

// NewPrivacyResponseRestorer returns nil for protocols whose responses carry no
// model text.
func NewPrivacyResponseRestorer(protocol string, vault *privacyfilter.Vault) *PrivacyResponseRestorer {
	switch protocol {
	case ContentModerationProtocolAnthropicMessages, ContentModerationProtocolOpenAIChat,
		ContentModerationProtocolOpenAIResponses, ContentModerationProtocolGemini:
	default:
		return nil
	}
	if vault == nil {
		return nil
	}
	return &PrivacyResponseRestorer{protocol: protocol, vault: vault, streams: make(map[string]*privacyResponseStream)}
}

func (r *PrivacyResponseRestorer) active() bool { return r.vault.Len() > 0 }

func (r *PrivacyResponseRestorer) stream(key string, jsonText bool, template privacyResponseStream) *privacyResponseStream {
	if existing := r.streams[key]; existing != nil {
		return existing
	}
	template.restorer = r.vault.NewStream(jsonText)
	template.jsonText = jsonText
	r.streams[key] = &template
	r.order = append(r.order, key)
	return r.streams[key]
}

// take releases a stream's held-back text and forgets the stream.
func (r *PrivacyResponseRestorer) take(key string) (*privacyResponseStream, string) {
	s := r.streams[key]
	if s == nil {
		return nil, ""
	}
	delete(r.streams, key)
	return s, s.restorer.Flush()
}

// RestoreBody restores a complete, non-streaming response.
func (r *PrivacyResponseRestorer) RestoreBody(body []byte) []byte {
	if r == nil || !r.active() || !gjson.ValidBytes(body) {
		return body
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	p := newJSONPatcher(body)
	root := gjson.ParseBytes(body)
	switch r.protocol {
	case ContentModerationProtocolAnthropicMessages:
		r.anthropicContent(p, gjson.GetBytes(body, "content"))
	case ContentModerationProtocolOpenAIChat:
		gjson.GetBytes(body, "choices").ForEach(func(_, choice gjson.Result) bool {
			r.chatMessage(p, choice.Get("message"))
			return true
		})
	case ContentModerationProtocolOpenAIResponses:
		r.responsesOutput(p, gjson.GetBytes(body, "output"))
		r.responsesOutput(p, gjson.GetBytes(body, "response.output"))
	case ContentModerationProtocolGemini:
		if root.IsArray() {
			for i := range root.Array() {
				r.geminiWhole(p, gjson.GetBytes(body, strconv.Itoa(i)))
			}
		} else {
			r.geminiWhole(p, root)
		}
	}
	out, err := p.apply()
	if err != nil {
		return body
	}
	return out
}

// RestoreEvent restores one streamed event and returns the events to send in
// its place, which may include an extra event that releases held-back text.
func (r *PrivacyResponseRestorer) RestoreEvent(name string, data []byte) []PrivacyEvent {
	if r == nil || !r.active() {
		return []PrivacyEvent{{Name: name, Data: data}}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.protocol == ContentModerationProtocolOpenAIChat && strings.TrimSpace(string(data)) == "[DONE]" {
		return append(r.flushAll(), PrivacyEvent{Name: name, Data: data})
	}
	if !gjson.ValidBytes(data) {
		return []PrivacyEvent{{Name: name, Data: data}}
	}
	var before []PrivacyEvent
	var out []byte
	var err error
	switch r.protocol {
	case ContentModerationProtocolAnthropicMessages:
		before, out, err = r.anthropicEvent(data)
	case ContentModerationProtocolOpenAIChat:
		before, out, err = r.chatEvent(data)
	case ContentModerationProtocolOpenAIResponses:
		before, out, err = r.responsesEvent(data)
	case ContentModerationProtocolGemini:
		out, err = r.geminiEvent(data)
	}
	if err != nil {
		return []PrivacyEvent{{Name: name, Data: data}}
	}
	events := append(before, PrivacyEvent{Name: name, Data: out})
	return events
}

// Finish releases text still held back when the stream ends without the
// events that normally close each position.
func (r *PrivacyResponseRestorer) Finish() []PrivacyEvent {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.flushAll()
}

func (r *PrivacyResponseRestorer) flushAll() []PrivacyEvent {
	var events []PrivacyEvent
	order := r.order
	r.order = nil
	for _, key := range order {
		s, rest := r.take(key)
		if s == nil || rest == "" {
			continue
		}
		if event, ok := r.releaseEvent(s, rest); ok {
			events = append(events, event)
		}
	}
	return events
}

func (r *PrivacyResponseRestorer) releaseEvent(s *privacyResponseStream, rest string) (PrivacyEvent, bool) {
	var payload any
	name := ""
	switch r.protocol {
	case ContentModerationProtocolAnthropicMessages:
		name = "content_block_delta"
		delta := map[string]any{"type": "text_delta", "text": rest}
		if s.jsonText {
			delta = map[string]any{"type": "input_json_delta", "partial_json": rest}
		}
		payload = map[string]any{"type": "content_block_delta", "index": s.index, "delta": delta}
	case ContentModerationProtocolOpenAIChat:
		delta := map[string]any{"content": rest}
		if s.tool >= 0 {
			delta = map[string]any{"tool_calls": []any{map[string]any{"index": s.tool, "function": map[string]any{"arguments": rest}}}}
		}
		payload = map[string]any{"object": "chat.completion.chunk", "choices": []any{map[string]any{"index": s.index, "delta": delta, "finish_reason": nil}}}
	case ContentModerationProtocolOpenAIResponses:
		name = s.eventType
		event := map[string]any{"type": s.eventType, "item_id": s.itemID, "delta": rest}
		if s.outputIndex.Exists() {
			event["output_index"] = json.RawMessage(s.outputIndex.Raw)
		}
		if s.content.Exists() {
			event["content_index"] = json.RawMessage(s.content.Raw)
		}
		payload = event
	case ContentModerationProtocolGemini:
		chunk := map[string]any{"candidates": []any{map[string]any{"index": s.index, "content": map[string]any{"role": "model", "parts": []any{map[string]any{"text": rest}}}}}}
		if r.wrapped {
			payload = map[string]any{"response": chunk}
		} else {
			payload = chunk
		}
	default:
		return PrivacyEvent{}, false
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return PrivacyEvent{}, false
	}
	return PrivacyEvent{Name: name, Data: data}, true
}

// restoreString restores a complete string value in place.
func (r *PrivacyResponseRestorer) restoreString(p *jsonPatcher, value gjson.Result, jsonText bool) {
	if value.Type != gjson.String || value.Str == "" {
		return
	}
	restored := r.vault.Restore(value.Str)
	if jsonText {
		restored = r.vault.RestoreJSON(value.Str)
	}
	if restored != value.Str {
		p.set(value, restored)
	}
}

func (r *PrivacyResponseRestorer) restoreLeaves(p *jsonPatcher, value gjson.Result) {
	if value.Type == gjson.String {
		r.restoreString(p, value, false)
		return
	}
	if !value.IsObject() && !value.IsArray() {
		return
	}
	value.ForEach(func(_, child gjson.Result) bool {
		r.restoreLeaves(p, child)
		return true
	})
}

func setStreamString(p *jsonPatcher, value gjson.Result, out string) {
	if value.Type == gjson.String && out != value.Str {
		p.set(value, out)
	}
}

// ---- Anthropic Messages ----

func (r *PrivacyResponseRestorer) anthropicContent(p *jsonPatcher, content gjson.Result) {
	content.ForEach(func(_, block gjson.Result) bool {
		switch block.Get("type").String() {
		case "text":
			r.restoreString(p, block.Get("text"), false)
		case "tool_use", "server_tool_use":
			r.restoreLeaves(p, block.Get("input"))
		}
		return true
	})
}

func (r *PrivacyResponseRestorer) anthropicEvent(data []byte) ([]PrivacyEvent, []byte, error) {
	p := newJSONPatcher(data)
	var before []PrivacyEvent
	index := int(gjson.GetBytes(data, "index").Int())
	key := fmt.Sprintf("a%d", index)
	switch gjson.GetBytes(data, "type").String() {
	case "message_start":
		r.anthropicContent(p, gjson.GetBytes(data, "message.content"))
	case "content_block_start":
		block := gjson.GetBytes(data, "content_block")
		switch block.Get("type").String() {
		case "text":
			r.restoreString(p, block.Get("text"), false)
		case "tool_use", "server_tool_use":
			r.restoreLeaves(p, block.Get("input"))
		}
	case "content_block_delta":
		delta := gjson.GetBytes(data, "delta")
		switch delta.Get("type").String() {
		case "text_delta":
			s := r.stream(key, false, privacyResponseStream{index: index, tool: -1})
			value := delta.Get("text")
			setStreamString(p, value, s.restorer.Push(value.Str))
		case "input_json_delta":
			s := r.stream(key, true, privacyResponseStream{index: index, tool: -1})
			value := delta.Get("partial_json")
			setStreamString(p, value, s.restorer.Push(value.Str))
		}
	case "content_block_stop":
		if s, rest := r.take(key); s != nil && rest != "" {
			if event, ok := r.releaseEvent(s, rest); ok {
				before = append(before, event)
			}
		}
	case "message_delta", "message_stop":
		before = r.flushAll()
	}
	out, err := p.apply()
	return before, out, err
}

// ---- OpenAI Chat Completions ----

func (r *PrivacyResponseRestorer) chatMessage(p *jsonPatcher, message gjson.Result) {
	r.restoreString(p, message.Get("content"), false)
	message.Get("tool_calls").ForEach(func(_, call gjson.Result) bool {
		r.restoreString(p, call.Get("function.arguments"), true)
		return true
	})
	r.restoreString(p, message.Get("function_call.arguments"), true)
}

func (r *PrivacyResponseRestorer) chatEvent(data []byte) ([]PrivacyEvent, []byte, error) {
	p := newJSONPatcher(data)
	var before []PrivacyEvent
	gjson.GetBytes(data, "choices").ForEach(func(position, choice gjson.Result) bool {
		index := int(position.Int())
		if choice.Get("index").Exists() {
			index = int(choice.Get("index").Int())
		}
		delta := choice.Get("delta")
		content := delta.Get("content")
		if content.Type == gjson.String {
			s := r.stream(fmt.Sprintf("c%d", index), false, privacyResponseStream{index: index, tool: -1})
			setStreamString(p, content, s.restorer.Push(content.Str))
		}
		delta.Get("tool_calls").ForEach(func(toolPosition, call gjson.Result) bool {
			tool := int(toolPosition.Int())
			if call.Get("index").Exists() {
				tool = int(call.Get("index").Int())
			}
			arguments := call.Get("function.arguments")
			if arguments.Type == gjson.String {
				s := r.stream(fmt.Sprintf("c%dt%d", index, tool), true, privacyResponseStream{index: index, tool: tool})
				setStreamString(p, arguments, s.restorer.Push(arguments.Str))
			}
			return true
		})
		r.chatMessage(p, choice.Get("message"))
		if finish := choice.Get("finish_reason"); finish.Exists() && finish.Type != gjson.Null && finish.String() != "" {
			prefix := fmt.Sprintf("c%d", index)
			for _, key := range append([]string(nil), r.order...) {
				if key != prefix && !strings.HasPrefix(key, prefix+"t") {
					continue
				}
				if s, rest := r.take(key); s != nil && rest != "" {
					if event, ok := r.releaseEvent(s, rest); ok {
						before = append(before, r.chatCopyIdentity(event, data))
					}
				}
			}
		}
		return true
	})
	out, err := p.apply()
	return before, out, err
}

// chatCopyIdentity gives a released chunk the id, created and model of the
// chunk it precedes, as clients group chunks by id.
func (r *PrivacyResponseRestorer) chatCopyIdentity(event PrivacyEvent, source []byte) PrivacyEvent {
	for _, field := range []string{"id", "created", "model", "system_fingerprint"} {
		if value := gjson.GetBytes(source, field); value.Exists() {
			if updated, err := sjson.SetRawBytes(event.Data, field, []byte(value.Raw)); err == nil {
				event.Data = updated
			}
		}
	}
	return event
}

// ---- OpenAI Responses (SSE and WebSocket) ----

func (r *PrivacyResponseRestorer) responsesOutput(p *jsonPatcher, output gjson.Result) {
	output.ForEach(func(_, item gjson.Result) bool {
		r.responsesItem(p, item)
		return true
	})
}

func (r *PrivacyResponseRestorer) responsesItem(p *jsonPatcher, item gjson.Result) {
	switch item.Get("type").String() {
	case "message":
		item.Get("content").ForEach(func(_, part gjson.Result) bool {
			if part.Get("type").String() == "output_text" {
				r.restoreString(p, part.Get("text"), false)
			}
			return true
		})
	case "function_call":
		r.restoreString(p, item.Get("arguments"), true)
	case "custom_tool_call":
		r.restoreString(p, item.Get("input"), false)
	}
}

func (r *PrivacyResponseRestorer) responsesEvent(data []byte) ([]PrivacyEvent, []byte, error) {
	p := newJSONPatcher(data)
	var before []PrivacyEvent
	eventType := gjson.GetBytes(data, "type").String()
	itemID := gjson.GetBytes(data, "item_id").String()
	position := privacyResponseStream{
		itemID:      itemID,
		outputIndex: gjson.GetBytes(data, "output_index"),
		content:     gjson.GetBytes(data, "content_index"),
		tool:        -1,
	}
	release := func(key string) {
		if s, rest := r.take(key); s != nil && rest != "" {
			if event, ok := r.releaseEvent(s, rest); ok {
				before = append(before, event)
			}
		}
	}
	textKey := "t|" + itemID + "|" + position.content.Raw
	switch eventType {
	case "response.output_text.delta":
		position.eventType = eventType
		s := r.stream(textKey, false, position)
		value := gjson.GetBytes(data, "delta")
		setStreamString(p, value, s.restorer.Push(value.Str))
	case "response.output_text.done":
		release(textKey)
		r.restoreString(p, gjson.GetBytes(data, "text"), false)
	case "response.function_call_arguments.delta":
		position.eventType = eventType
		s := r.stream("a|"+itemID, true, position)
		value := gjson.GetBytes(data, "delta")
		setStreamString(p, value, s.restorer.Push(value.Str))
	case "response.function_call_arguments.done":
		release("a|" + itemID)
		r.restoreString(p, gjson.GetBytes(data, "arguments"), true)
	case "response.custom_tool_call_input.delta":
		position.eventType = eventType
		s := r.stream("c|"+itemID, false, position)
		value := gjson.GetBytes(data, "delta")
		setStreamString(p, value, s.restorer.Push(value.Str))
	case "response.custom_tool_call_input.done":
		release("c|" + itemID)
		r.restoreString(p, gjson.GetBytes(data, "input"), false)
	case "response.content_part.added", "response.content_part.done":
		if part := gjson.GetBytes(data, "part"); part.Get("type").String() == "output_text" {
			r.restoreString(p, part.Get("text"), false)
		}
	case "response.output_item.added", "response.output_item.done":
		r.responsesItem(p, gjson.GetBytes(data, "item"))
	case "response.completed", "response.done", "response.incomplete", "response.failed":
		before = r.flushAll()
		r.responsesOutput(p, gjson.GetBytes(data, "response.output"))
	}
	out, err := p.apply()
	return before, out, err
}

// ---- Gemini ----

func (r *PrivacyResponseRestorer) geminiRoot(chunk gjson.Result) gjson.Result {
	if response := chunk.Get("response"); response.IsObject() && !chunk.Get("candidates").Exists() {
		r.wrapped = true
		return response
	}
	return chunk
}

func (r *PrivacyResponseRestorer) geminiWhole(p *jsonPatcher, chunk gjson.Result) {
	r.geminiRoot(chunk).Get("candidates").ForEach(func(_, candidate gjson.Result) bool {
		candidate.Get("content.parts").ForEach(func(_, part gjson.Result) bool {
			if !part.Get("thought").Bool() {
				r.restoreString(p, part.Get("text"), false)
			}
			r.restoreLeaves(p, part.Get("functionCall.args"))
			return true
		})
		return true
	})
}

func (r *PrivacyResponseRestorer) geminiEvent(data []byte) ([]byte, error) {
	root := r.geminiRoot(gjson.ParseBytes(data))
	prefix := ""
	if r.wrapped && !gjson.GetBytes(data, "candidates").Exists() {
		prefix = "response."
	}
	p := newJSONPatcher(data)
	type appendText struct {
		path string
		text string
	}
	var appends []appendText
	root.Get("candidates").ForEach(func(position, candidate gjson.Result) bool {
		index := int(position.Int())
		if candidate.Get("index").Exists() {
			index = int(candidate.Get("index").Int())
		}
		key := fmt.Sprintf("g%d", index)
		type pendingText struct {
			value gjson.Result
			out   string
		}
		var texts []pendingText
		candidate.Get("content.parts").ForEach(func(_, part gjson.Result) bool {
			r.restoreLeaves(p, part.Get("functionCall.args"))
			text := part.Get("text")
			if part.Get("thought").Bool() || text.Type != gjson.String {
				return true
			}
			s := r.stream(key, false, privacyResponseStream{index: index, tool: -1})
			texts = append(texts, pendingText{value: text, out: s.restorer.Push(text.Str)})
			return true
		})
		rest := ""
		if finish := candidate.Get("finishReason"); finish.Exists() && finish.String() != "" {
			_, rest = r.take(key)
		}
		if rest != "" && len(texts) > 0 {
			texts[len(texts)-1].out += rest
			rest = ""
		}
		for _, text := range texts {
			setStreamString(p, text.value, text.out)
		}
		if rest != "" {
			appends = append(appends, appendText{
				path: fmt.Sprintf("%scandidates.%d.content.parts.-1", prefix, position.Int()),
				text: rest,
			})
		}
		return true
	})
	out, err := p.apply()
	if err != nil {
		return nil, err
	}
	for _, extra := range appends {
		if out, err = sjson.SetBytes(out, extra.path, map[string]any{"text": extra.text}); err != nil {
			return nil, err
		}
	}
	return out, nil
}
