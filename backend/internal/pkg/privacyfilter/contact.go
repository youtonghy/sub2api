package privacyfilter

import (
	"net/netip"
	"regexp"
	"strings"
)

var (
	reEmail       = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	reIPv4        = regexp.MustCompile(`(?:(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])`)
	reIPv6        = regexp.MustCompile(`[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){3,7}`)
	reVersionLead = regexp.MustCompile(`(?i)(?:\b(?:version|ver\.?|release|v)|==|>=|<=|~=|\^|~)\s*$`)
)

var sshCommands = []string{"ssh ", "scp ", "rsync ", "sftp ", "ssh-copy-id "}

func appendEmailSpans(spans []span, text string) []span {
	if !strings.Contains(text, "@") {
		return spans
	}
	for _, m := range reEmail.FindAllStringIndex(text, -1) {
		if isBenignEmail(text, m[0], m[1]) {
			continue
		}
		spans = append(spans, span{m[0], m[1], CategoryEmail})
	}
	return spans
}

// isBenignEmail skips SSH-style targets (git@host:path, ssh user@host), commit
// trailers from automation, and documentation domains.
func isBenignEmail(text string, start, end int) bool {
	if end+1 < len(text) && text[end] == ':' && text[end+1] != ' ' && text[end+1] != '\t' {
		return true
	}
	lineStart := strings.LastIndexByte(text[:start], '\n') + 1
	line := text[lineStart:start]
	for _, command := range sshCommands {
		if strings.Contains(line, command) {
			return true
		}
	}
	lowered := strings.ToLower(text[start:end])
	if strings.HasPrefix(lowered, "noreply@") || strings.HasPrefix(lowered, "no-reply@") {
		return true
	}
	return strings.HasSuffix(lowered, "@example.com") || strings.HasSuffix(lowered, "@example.org") || strings.HasSuffix(lowered, ".example.com")
}

func appendIPSpans(spans []span, text string) []span {
	for _, m := range reIPv4.FindAllStringIndex(text, -1) {
		if keepIPv4(text, m[0], m[1]) {
			spans = append(spans, span{m[0], m[1], CategoryIP})
		}
	}
	if !strings.Contains(text, ":") {
		return spans
	}
	for _, m := range reIPv6.FindAllStringIndex(text, -1) {
		if keepIPv6(text, m[0], m[1]) {
			spans = append(spans, span{m[0], m[1], CategoryIP})
		}
	}
	return spans
}

func keepIPv4(text string, start, end int) bool {
	if start > 0 && (isDigit(text[start-1]) || text[start-1] == '.') {
		return false
	}
	if end < len(text) && (isDigit(text[end]) || text[end] == '.') {
		return false
	}
	lookback := start - 12
	if lookback < 0 {
		lookback = 0
	}
	if reVersionLead.MatchString(text[lookback:start]) {
		return false
	}
	addr, err := netip.ParseAddr(text[start:end])
	return err == nil && !isNonIdentifyingIP(addr)
}

func keepIPv6(text string, start, end int) bool {
	value := text[start:end]
	if start > 0 && (isHexDigit(text[start-1]) || text[start-1] == ':') {
		return false
	}
	if end < len(text) && (isHexDigit(text[end]) || text[end] == ':') {
		return false
	}
	// Short colon runs such as std::cout or 12:30:45 are not addresses.
	if strings.Count(value, ":") < 4 {
		return false
	}
	addr, err := netip.ParseAddr(value)
	return err == nil && addr.Is6() && !isNonIdentifyingIP(addr)
}

func isHexDigit(c byte) bool {
	return isDigit(c) || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'
}

func isNonIdentifyingIP(addr netip.Addr) bool {
	if addr.IsLoopback() || addr.IsUnspecified() || addr.IsLinkLocalUnicast() || addr.IsMulticast() {
		return true
	}
	return addr == netip.AddrFrom4([4]byte{255, 255, 255, 255})
}
