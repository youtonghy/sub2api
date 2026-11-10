package privacyfilter

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
)

const (
	tokenPrefix    = "[REDACTED:"
	tokenMinHex    = 8
	tokenMaxHex    = 64
	maxTokenLength = len(tokenPrefix) + 32 + 1 + tokenMaxHex + 1

	// maxVaultEntries bounds a long WebSocket session. Values past the limit
	// are still redacted but cannot be restored.
	maxVaultEntries = 20000

	// minUserKnownValueLength keeps short values such as a four-digit PIN from
	// replacing every unrelated occurrence of the same word in user text.
	minUserKnownValueLength = 8
)

// reToken matches restorable placeholders. Case is ignored because models
// sometimes change the case of text they copy.
var reToken = regexp.MustCompile(`(?i)\[REDACTED:[a-z_]{1,32}:[0-9a-f]{8,64}\]`)

// Vault maps restorable placeholders to the values they replace for one
// request or one WebSocket connection. It lives only in memory.
//
// Placeholders are deterministic: an HMAC of the value under a per-API-key
// key. The same value therefore gets the same placeholder on every turn, which
// keeps upstream prompt caches valid, while different API keys cannot be
// correlated and the upstream cannot test guesses without the key.
type Vault struct {
	key []byte

	mu      sync.RWMutex
	byHash  map[string]string // lower-case hex suffix -> value
	byValue map[string]string // value -> placeholder

	plain, escaped, userPlain *strings.Replacer

	restored, unresolved atomic.Int64
}

// NewVault creates an empty vault. key must be secret and stable for the
// API key so placeholders stay the same across requests.
func NewVault(key []byte) *Vault {
	return &Vault{
		key:     append([]byte(nil), key...),
		byHash:  make(map[string]string),
		byValue: make(map[string]string),
	}
}

// Len returns the number of stored values.
func (v *Vault) Len() int {
	if v == nil {
		return 0
	}
	v.mu.RLock()
	defer v.mu.RUnlock()
	return len(v.byValue)
}

// Stats returns how many placeholders were restored and how many matched the
// placeholder shape but had no stored value.
func (v *Vault) Stats() (restored, unresolved int64) {
	if v == nil {
		return 0, 0
	}
	return v.restored.Load(), v.unresolved.Load()
}

// Token returns the placeholder for value, storing the pair.
func (v *Vault) Token(category Category, value string) string {
	v.mu.Lock()
	defer v.mu.Unlock()
	if token, ok := v.byValue[value]; ok {
		return token
	}
	mac := hmac.New(sha256.New, v.key)
	mac.Write([]byte(value))
	digest := hex.EncodeToString(mac.Sum(nil))
	for length := tokenMinHex; length <= tokenMaxHex; length += 4 {
		suffix := digest[:length]
		existing, taken := v.byHash[suffix]
		if taken && existing != value {
			continue
		}
		token := tokenPrefix + string(category) + ":" + suffix + "]"
		if len(v.byValue) >= maxVaultEntries {
			return token
		}
		v.byHash[suffix] = value
		v.byValue[value] = token
		v.plain, v.escaped, v.userPlain = nil, nil, nil
		return token
	}
	// Every suffix length collided, which cannot happen with SHA-256 in practice.
	return Placeholder(category)
}

// RedactMatches replaces detections with restorable placeholders.
func (v *Vault) RedactMatches(text string, matches []Match) Result {
	return Replace(text, matches, func(m Match, value string) string { return v.Token(m.Category, value) })
}

// ReplaceKnown swaps every stored value found in text for its placeholder,
// leaving existing placeholders alone. Restored model output travels back in
// the next request's history, so this must be the exact inverse of Restore.
// userText applies a minimum length to avoid rewriting common words.
func (v *Vault) ReplaceKnown(text string, userText bool) (string, bool) {
	replacer := v.replacer(false, userText)
	return replaceOutsideTokens(text, replacer)
}

// ReplaceKnownJSON is ReplaceKnown for text that is itself JSON, such as tool
// call arguments, where values appear in their escaped form.
func (v *Vault) ReplaceKnownJSON(text string) (string, bool) {
	return replaceOutsideTokens(text, v.replacer(true, false))
}

func replaceOutsideTokens(text string, replacer *strings.Replacer) (string, bool) {
	if replacer == nil || text == "" {
		return text, false
	}
	locations := reToken.FindAllStringIndex(text, -1)
	if len(locations) == 0 {
		out := replacer.Replace(text)
		return out, out != text
	}
	var b strings.Builder
	previous := 0
	for _, loc := range locations {
		b.WriteString(replacer.Replace(text[previous:loc[0]]))
		b.WriteString(text[loc[0]:loc[1]])
		previous = loc[1]
	}
	b.WriteString(replacer.Replace(text[previous:]))
	out := b.String()
	return out, out != text
}

func (v *Vault) replacer(escaped, userText bool) *strings.Replacer {
	v.mu.RLock()
	cached := v.plain
	if escaped {
		cached = v.escaped
	} else if userText {
		cached = v.userPlain
	}
	empty := len(v.byValue) == 0
	v.mu.RUnlock()
	if cached != nil || empty {
		return cached
	}

	v.mu.Lock()
	defer v.mu.Unlock()
	values := make([]string, 0, len(v.byValue))
	for value := range v.byValue {
		if userText && len(value) < minUserKnownValueLength {
			continue
		}
		values = append(values, value)
	}
	// Longest first so a value never pre-empts a longer one that contains it.
	sort.Slice(values, func(i, j int) bool {
		if len(values[i]) != len(values[j]) {
			return len(values[i]) > len(values[j])
		}
		return values[i] < values[j]
	})
	pairs := make([]string, 0, 2*len(values))
	for _, value := range values {
		form := value
		if escaped {
			form = EscapeJSONText(value)
		}
		pairs = append(pairs, form, v.byValue[value])
	}
	replacer := strings.NewReplacer(pairs...)
	switch {
	case escaped:
		v.escaped = replacer
	case userText:
		v.userPlain = replacer
	default:
		v.plain = replacer
	}
	return replacer
}

// Restore replaces placeholders with their values.
func (v *Vault) Restore(text string) string { return v.restore(text, false) }

// RestoreJSON replaces placeholders inside JSON text with escaped values.
func (v *Vault) RestoreJSON(text string) string { return v.restore(text, true) }

func (v *Vault) restore(text string, escaped bool) string {
	if v == nil || strings.IndexByte(text, '[') < 0 {
		return text
	}
	return reToken.ReplaceAllStringFunc(text, func(token string) string {
		suffix := strings.ToLower(token[strings.LastIndexByte(token, ':')+1 : len(token)-1])
		v.mu.RLock()
		value, ok := v.byHash[suffix]
		v.mu.RUnlock()
		if !ok {
			v.unresolved.Add(1)
			return token
		}
		v.restored.Add(1)
		if escaped {
			return EscapeJSONText(value)
		}
		return value
	})
}

// EscapeJSONText returns value as it appears inside a JSON string literal.
func EscapeJSONText(value string) string {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return value
	}
	encoded := bytes.TrimRight(buffer.Bytes(), "\n")
	return string(encoded[1 : len(encoded)-1])
}
