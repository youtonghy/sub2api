package privacyfilter

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	// reContextCredential finds "name <delimiter> value" assignments in prose and
	// configs. Groups: 1 name, 2 quoted value, 3 unquoted value.
	reContextCredential = regexp.MustCompile(`(?i)(密码|口令|密钥|令牌|password|passwd|pwd|passphrase|secret|token|api[_\s-]?key|access[_-]?key)["'\x60]?\s*(?:是|为|:=|=>|:|：|=)\s*(?:["'\x60]([^"'\x60\r\n]{4,512})["'\x60]|([^\s"'\x60，。；;,)}\]]{4,512}))`)

	reAuthorizationHeader = regexp.MustCompile(`(?i)authorization["']?\s*[:=]\s*["']?(?:bearer|basic|token|digest|apikey)\s+([^\s"']{8,})`)
	reBearerToken         = regexp.MustCompile(`(?i)\bbearer\s+([A-Za-z0-9._~+/-]{16,}={0,2})`)

	// reURLPassword captures the password in scheme://user:password@host.
	reURLPassword = regexp.MustCompile(`(?i)\b[a-z][a-z0-9+.-]{1,30}://[^\s/:@"'\x60?#]*:([^\s/@"'\x60?#]{1,512})@[^\s/]`)

	// reURLQueryCredential groups: 1 parameter name, 2 value.
	reURLQueryCredential = regexp.MustCompile(`(?i)[?&](access_token|auth_token|id_token|refresh_token|token|api_key|apikey|api-key|client_secret|secret|password|passwd|pwd|auth|sig|signature|key)=([^&\s"'\x60#]{8,1000})`)

	reDottedIdentifier = regexp.MustCompile(`^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$`)
	rePlainIdentifier  = regexp.MustCompile(`^[A-Za-z_][A-Za-z_-]*$`)
	reDigitsOnly       = regexp.MustCompile(`^[0-9]+$`)
)

// passwordKeywords may legitimately hold digit-only values; for token-like names
// such values are almost always counters, e.g. "input_token: 4096".
var passwordKeywords = map[string]bool{
	"密码": true, "口令": true, "password": true, "passwd": true, "pwd": true, "passphrase": true,
}

// typeWords are type names and literals found after credential-like field names.
var typeWords = map[string]bool{
	"string": true, "str": true, "number": true, "integer": true, "int": true, "bool": true, "boolean": true,
	"object": true, "array": true, "bytes": true, "any": true, "null": true, "nil": true, "none": true,
	"true": true, "false": true, "undefined": true, "required": true, "optional": true, "text": true,
	"password": true, "secret": true, "token": true, "empty": true, "hidden": true,
}

var placeholderMarkers = []string{
	"[REDACTED", "REPLACE_ME", "REPLACE_THIS", "REPLACE_WITH", "YOUR_", "YOUR-", "<YOUR", "INSERT_", "PLACEHOLDER",
	"EXAMPLE", "CHANGEME", "CHANGE_ME", "CHANGE-ME", "TODO", "FIXME", "XXXX", "****", "••••",
}

// isPlaceholderValue reports template variables and documentation placeholders.
// Recognising [REDACTED also keeps repeated redaction idempotent, which matters
// because clients resend conversation history on every turn.
func isPlaceholderValue(value string) bool {
	if strings.HasPrefix(value, "${") || strings.HasPrefix(value, "{{") || strings.HasPrefix(value, "%{") ||
		strings.HasPrefix(value, "$(") || strings.HasPrefix(value, "<") || strings.HasPrefix(value, "{") {
		return true
	}
	upper := strings.ToUpper(value)
	for _, marker := range placeholderMarkers {
		if strings.Contains(upper, marker) {
			return true
		}
	}
	return false
}

func containsCJK(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r) {
			return true
		}
	}
	return false
}

func appendContextCredentialSpans(spans []span, text string) []span {
	for _, m := range reContextCredential.FindAllStringSubmatchIndex(text, -1) {
		keyword := strings.ToLower(text[m[2]:m[3]])
		quoted := m[4] >= 0
		start, end := m[6], m[7]
		if quoted {
			start, end = m[4], m[5]
		}
		if start < 0 {
			continue
		}
		// In a URL query the value ends at the next parameter.
		if separator := strings.IndexByte(text[start:end], '&'); !quoted && separator > 0 && strings.Contains(text[start+separator:end], "=") {
			end = start + separator
		}
		if !acceptContextValue(keyword, text[start:end], quoted) {
			continue
		}
		spans = append(spans, span{start, end, CategoryCredential})
	}
	for _, m := range reAuthorizationHeader.FindAllStringSubmatchIndex(text, -1) {
		if value := text[m[2]:m[3]]; !isPlaceholderValue(value) {
			spans = append(spans, span{m[2], m[3], CategoryCredential})
		}
	}
	for _, m := range reBearerToken.FindAllStringSubmatchIndex(text, -1) {
		if value := text[m[2]:m[3]]; !isPlaceholderValue(value) && hasLetterAndDigit(value) {
			spans = append(spans, span{m[2], m[3], CategoryCredential})
		}
	}
	if strings.Contains(text, "://") {
		for _, m := range reURLPassword.FindAllStringSubmatchIndex(text, -1) {
			if value := text[m[2]:m[3]]; !isPlaceholderValue(value) {
				spans = append(spans, span{m[2], m[3], CategoryCredential})
			}
		}
	}
	for _, m := range reURLQueryCredential.FindAllStringSubmatchIndex(text, -1) {
		name := strings.ToLower(text[m[2]:m[3]])
		value := text[m[4]:m[5]]
		if isPlaceholderValue(value) {
			continue
		}
		// These names are also common for ordinary parameters.
		if (name == "key" || name == "sig" || name == "signature" || name == "auth") && (len(value) < 16 || !hasLetterAndDigit(value)) {
			continue
		}
		spans = append(spans, span{m[4], m[5], CategoryCredential})
	}
	return spans
}

// acceptContextValue separates real credentials from source code. Coding agents
// send far more "token = getToken()" than real secrets, so unquoted English
// assignments must not look like an identifier, call, path or type name.
func acceptContextValue(keyword, value string, quoted bool) bool {
	value = strings.TrimSpace(value)
	if len(value) < 4 || isPlaceholderValue(value) || containsCJK(value) {
		return false
	}
	if typeWords[strings.ToLower(value)] || strings.EqualFold(value, keyword) {
		return false
	}
	if quoted || !isASCII(keyword) {
		return true
	}
	if strings.ContainsAny(value, "()[]{}<>$`\\") || strings.Contains(value, "://") {
		return false
	}
	if strings.HasPrefix(value, "/") || strings.HasPrefix(value, "./") || strings.HasPrefix(value, "../") || strings.HasPrefix(value, "~/") {
		return false
	}
	if reDottedIdentifier.MatchString(value) || rePlainIdentifier.MatchString(value) {
		return false
	}
	if reDigitsOnly.MatchString(value) {
		return passwordKeywords[keyword]
	}
	return true
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

func hasLetterAndDigit(s string) bool {
	var letter, digit bool
	for i := 0; i < len(s); i++ {
		c := s[i]
		letter = letter || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z'
		digit = digit || c >= '0' && c <= '9'
	}
	return letter && digit
}
