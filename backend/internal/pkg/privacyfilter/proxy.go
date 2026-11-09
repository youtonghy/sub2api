package privacyfilter

import (
	"regexp"
	"strings"
)

var (
	reProxyShareLink = regexp.MustCompile(`(?i)\b(?:vless|vmess|trojan|ssr?|tuic|hysteria2?|hy2|anytls|wireguard|wg)://[^\s"'\x60<>]{8,}`)

	// reProxyConfigMarker decides whether text is a proxy configuration. Field
	// names like "id" and "sid" are only meaningful once this holds.
	reProxyConfigMarker = regexp.MustCompile(`(?i)"protocol"\s*:\s*"(?:vless|vmess|trojan|shadowsocks|hysteria2?|tuic)"|\btype:\s*["']?(?:vless|vmess|trojan|ssr?|hysteria2?|tuic|anytls)\b|realitySettings|reality-opts|proxy-providers|"outbounds"\s*:|\[Interface\][\s\S]{0,400}PrivateKey`)

	reProxyUUIDField   = regexp.MustCompile(`(?i)["']?\b(?:uuid|id)["']?\s*[:=]\s*["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`)
	reProxySecretField = regexp.MustCompile(`(?i)["']?\b(?:password|passwd|auth|auth-str|auth_str|obfs-password|psk|pre-?shared-?key|privateKey|private-key|private_key)["']?\s*[:=]\s*["']?([^\s"',}\]]{4,512})`)
	reProxyShortIDs    = regexp.MustCompile(`(?i)["']?\b(?:shortIds?|short[-_]ids?|sid)["']?\s*[:=]\s*(\[[^\]]{0,1000}\]|["']?[0-9a-f]{2,16}["']?)`)
	reHexToken         = regexp.MustCompile(`\b[0-9a-fA-F]{2,16}\b`)

	reSubscriptionPath  = regexp.MustCompile(`(?i)https?://[^\s"'\x60]+/(?:sub|subscribe|subscription|link|clash|api/v[0-9]+/client/subscribe)/([A-Za-z0-9_-]{16,})`)
	reSubscriptionQuery = regexp.MustCompile(`(?i)https?://[^\s"'\x60?]+\?[^\s"'\x60]*\b(?:token|key|sub)=([^&\s"'\x60#]{8,})`)
)

// appendProxySpans hides share links anywhere, and inside recognised proxy
// configurations also hides client IDs, short IDs, passwords and subscription
// tokens. Public keys such as Reality's stay visible.
func appendProxySpans(spans []span, text string) []span {
	if strings.Contains(text, "://") {
		for _, m := range reProxyShareLink.FindAllStringIndex(text, -1) {
			spans = append(spans, span{m[0], m[1], CategoryProxy})
		}
	}
	if !reProxyConfigMarker.MatchString(text) {
		return spans
	}
	for _, re := range []*regexp.Regexp{reProxyUUIDField, reSubscriptionPath, reSubscriptionQuery} {
		for _, m := range re.FindAllStringSubmatchIndex(text, -1) {
			spans = append(spans, span{m[2], m[3], CategoryProxy})
		}
	}
	for _, m := range reProxySecretField.FindAllStringSubmatchIndex(text, -1) {
		if !isPlaceholderValue(text[m[2]:m[3]]) {
			spans = append(spans, span{m[2], m[3], CategoryProxy})
		}
	}
	for _, m := range reProxyShortIDs.FindAllStringSubmatchIndex(text, -1) {
		value := text[m[2]:m[3]]
		for _, token := range reHexToken.FindAllStringIndex(value, -1) {
			spans = append(spans, span{m[2] + token[0], m[2] + token[1], CategoryProxy})
		}
	}
	return spans
}
