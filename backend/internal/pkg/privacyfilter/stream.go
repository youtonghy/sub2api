package privacyfilter

// StreamRestorer restores placeholders in text that arrives in pieces. A piece
// that ends in what could be the start of a placeholder is held back until the
// next piece shows whether it is one.
type StreamRestorer struct {
	vault   *Vault
	json    bool
	pending string
}

// NewStream creates a restorer for one stream position. jsonText selects the
// escaped form, for streams that carry JSON such as tool call arguments.
func (v *Vault) NewStream(jsonText bool) *StreamRestorer {
	return &StreamRestorer{vault: v, json: jsonText}
}

// Push adds a piece and returns the text that is safe to emit now.
func (s *StreamRestorer) Push(piece string) string {
	buffer := s.pending + piece
	hold := partialTokenStart(buffer)
	s.pending = buffer[hold:]
	return s.vault.restore(buffer[:hold], s.json)
}

// Flush returns everything still held back.
func (s *StreamRestorer) Flush() string {
	rest := s.pending
	s.pending = ""
	return s.vault.restore(rest, s.json)
}

// Pending reports whether text is being held back.
func (s *StreamRestorer) Pending() bool { return s.pending != "" }

// partialTokenStart returns where an unfinished placeholder begins at the end
// of text, or len(text) when there is none. Placeholders contain no '[' after
// the first byte, so only the last '[' can start one.
func partialTokenStart(text string) int {
	start := -1
	for i := len(text) - 1; i >= 0 && len(text)-i <= maxTokenLength; i-- {
		if text[i] == '[' {
			start = i
			break
		}
		if text[i] == ']' {
			return len(text)
		}
	}
	if start < 0 || !isTokenPrefix(text[start:]) {
		return len(text)
	}
	return start
}

func isTokenPrefix(s string) bool {
	for i := 0; i < len(s) && i < len(tokenPrefix); i++ {
		if upper(s[i]) != tokenPrefix[i] {
			return false
		}
	}
	if len(s) <= len(tokenPrefix) {
		return true
	}
	rest := s[len(tokenPrefix):]
	i := 0
	for i < len(rest) && (rest[i] >= 'a' && rest[i] <= 'z' || rest[i] >= 'A' && rest[i] <= 'Z' || rest[i] == '_') {
		i++
	}
	if i == len(rest) {
		return i <= 32
	}
	if rest[i] != ':' || i == 0 {
		return false
	}
	hexPart := rest[i+1:]
	if len(hexPart) > tokenMaxHex {
		return false
	}
	for j := 0; j < len(hexPart); j++ {
		if !isHexDigit(hexPart[j]) {
			return false
		}
	}
	return true
}

func upper(c byte) byte {
	if c >= 'a' && c <= 'z' {
		return c - 'a' + 'A'
	}
	return c
}
