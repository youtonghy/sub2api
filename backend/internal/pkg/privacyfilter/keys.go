package privacyfilter

import (
	"regexp"
	"strings"
)

// maxKeyBlockBytes bounds how far a PEM block is searched for its END line.
const maxKeyBlockBytes = 64 * 1024

var (
	rePrivateKeyBegin = regexp.MustCompile(`(?i)-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----`)
	rePrivateKeyEnd   = regexp.MustCompile(`(?i)-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----`)
	rePublicPEMBegin  = regexp.MustCompile(`-----BEGIN (?:[A-Z0-9]+ )*(?:PUBLIC KEY(?: BLOCK)?|CERTIFICATE)-----`)
	rePublicPEMEnd    = regexp.MustCompile(`-----END (?:[A-Z0-9]+ )*(?:PUBLIC KEY(?: BLOCK)?|CERTIFICATE)-----`)
	reSSHPublicKey    = regexp.MustCompile(`\b(?:ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-nistp[0-9]+|sk-(?:ssh-ed25519|ecdsa-sha2-nistp[0-9]+)@openssh\.com) +AAAA[0-9A-Za-z+/]{16,}={0,3}`)
)

func appendPrivateKeySpans(spans []span, text string) []span {
	if !strings.Contains(text, "-----") {
		return spans
	}
	return appendPEMSpans(spans, text, rePrivateKeyBegin, rePrivateKeyEnd, CategoryPrivateKey)
}

func appendPublicKeySpans(spans []span, text string) []span {
	if strings.Contains(text, "-----") {
		spans = appendPEMSpans(spans, text, rePublicPEMBegin, rePublicPEMEnd, CategoryPublicKey)
	}
	for _, m := range reSSHPublicKey.FindAllStringIndex(text, -1) {
		spans = append(spans, span{m[0], m[1], CategoryPublicKey})
	}
	return spans
}

// appendPEMSpans covers a block through its END line. Without an END line, as in
// truncated tool output, it covers the base64 body that follows the header.
func appendPEMSpans(spans []span, text string, begin, end *regexp.Regexp, category Category) []span {
	for _, m := range begin.FindAllStringIndex(text, -1) {
		limit := m[1] + maxKeyBlockBytes
		if limit > len(text) {
			limit = len(text)
		}
		if loc := end.FindStringIndex(text[m[1]:limit]); loc != nil {
			spans = append(spans, span{m[0], m[1] + loc[1], category})
			continue
		}
		spans = append(spans, span{m[0], pemBodyEnd(text, m[1], limit), category})
	}
	return spans
}

// pemBodyEnd walks base64 and line breaks, including the literal \n found in
// text that was escaped once already, and stops before trailing whitespace.
func pemBodyEnd(text string, from, limit int) int {
	last := from
	for i := from; i < limit; {
		c := text[i]
		switch {
		case isBase64Byte(c):
			i++
			last = i
		case c == '\n' || c == '\r' || c == ' ' || c == '\t':
			i++
		case c == '\\' && i+1 < limit && (text[i+1] == 'n' || text[i+1] == 'r'):
			i += 2
		case c == ':' || c == '-' || c == ',':
			// PEM headers such as Proc-Type: 4,ENCRYPTED.
			i++
			last = i
		default:
			return last
		}
	}
	return last
}

func isBase64Byte(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/' || c == '='
}
