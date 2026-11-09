// Package privacyfilter finds sensitive values in free text and replaces them
// with typed placeholders such as [REDACTED:credential].
//
// Redaction is irreversible and best effort: it lowers the chance that secrets
// and personal data reach an upstream model, but it is not a security boundary.
//
// Results carry category counts only. Matched values are never returned, so
// callers cannot log them by accident.
package privacyfilter

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

// Category groups detectors under one administrator-facing switch.
type Category string

const (
	CategoryPrivateKey Category = "private_key"
	CategoryPublicKey  Category = "public_key"
	CategoryCredential Category = "credential"
	CategoryFinancial  Category = "financial"
	CategoryIdentity   Category = "identity"
	CategoryProxy      Category = "proxy"
	CategoryEmail      Category = "email"
	CategoryIP         Category = "ip"
)

// categories is ordered by placeholder precedence: when detections overlap, the
// merged span is labelled with the earliest category in this list.
var categories = []Category{
	CategoryPrivateKey,
	CategoryPublicKey,
	CategoryProxy,
	CategoryCredential,
	CategoryFinancial,
	CategoryIdentity,
	CategoryEmail,
	CategoryIP,
}

// AllCategories returns every supported category.
func AllCategories() []Category { return append([]Category(nil), categories...) }

// DefaultCategories returns the categories enabled when a configuration does
// not choose its own. Public keys, IP addresses and email addresses stay off:
// they are low sensitivity and redacting them often breaks agent workflows.
func DefaultCategories() []Category {
	return []Category{CategoryPrivateKey, CategoryCredential, CategoryFinancial, CategoryIdentity, CategoryProxy}
}

// IsValidCategory reports whether name is a supported category.
func IsValidCategory(name string) bool {
	for _, c := range categories {
		if string(c) == name {
			return true
		}
	}
	return false
}

// CategorySet is a bit set of enabled categories.
type CategorySet uint16

// NewCategorySet builds a set from names, ignoring unknown entries.
func NewCategorySet(names ...Category) CategorySet {
	var set CategorySet
	for _, name := range names {
		for i, c := range categories {
			if c == name {
				set |= 1 << i
			}
		}
	}
	return set
}

// Has reports whether c is in the set.
func (s CategorySet) Has(c Category) bool {
	for i, candidate := range categories {
		if candidate == c {
			return s&(1<<i) != 0
		}
	}
	return false
}

// Result is the outcome of one Redact call.
type Result struct {
	Text    string
	Changed bool
	Counts  map[Category]int
}

// span is a byte range to replace, always within the scanned text.
type span struct {
	start, end int
	category   Category
}

// Detector holds the compiled rules. It is immutable and safe for concurrent use.
type Detector struct {
	secrets *secretRules
}

// New compiles the embedded rule set.
func New() (*Detector, error) {
	secrets, err := loadSecretRules()
	if err != nil {
		return nil, fmt.Errorf("load secret rules: %w", err)
	}
	return &Detector{secrets: secrets}, nil
}

var (
	sharedOnce     sync.Once
	sharedDetector *Detector
	errShared      error
)

// Shared returns a process-wide Detector, compiling it on first use.
func Shared() (*Detector, error) {
	sharedOnce.Do(func() { sharedDetector, errShared = New() })
	return sharedDetector, errShared
}

// Placeholder returns the replacement text used for a category.
func Placeholder(c Category) string { return "[REDACTED:" + string(c) + "]" }

// Redact replaces every detection whose category is enabled.
func (d *Detector) Redact(text string, enabled CategorySet) Result {
	result := Result{Text: text}
	if text == "" || enabled == 0 {
		return result
	}

	var spans []span
	if enabled.Has(CategoryPrivateKey) {
		spans = appendPrivateKeySpans(spans, text)
	}
	if enabled.Has(CategoryPublicKey) {
		spans = appendPublicKeySpans(spans, text)
	}
	if enabled.Has(CategoryCredential) {
		spans = d.secrets.appendSpans(spans, text)
		spans = appendContextCredentialSpans(spans, text)
	}
	if enabled.Has(CategoryFinancial) {
		spans = appendFinancialSpans(spans, text)
	}
	if enabled.Has(CategoryIdentity) {
		spans = appendIdentitySpans(spans, text)
	}
	if enabled.Has(CategoryProxy) {
		spans = appendProxySpans(spans, text)
	}
	if enabled.Has(CategoryEmail) {
		spans = appendEmailSpans(spans, text)
	}
	if enabled.Has(CategoryIP) {
		spans = appendIPSpans(spans, text)
	}

	merged := mergeSpans(spans)
	if len(merged) == 0 {
		return result
	}

	var b strings.Builder
	b.Grow(len(text))
	counts := make(map[Category]int, 2)
	previous := 0
	for _, s := range merged {
		b.WriteString(text[previous:s.start])
		b.WriteString(Placeholder(s.category))
		previous = s.end
		counts[s.category]++
	}
	b.WriteString(text[previous:])

	result.Text = b.String()
	result.Changed = true
	result.Counts = counts
	return result
}

// mergeSpans unions overlapping spans so no fragment of a partially overlapped
// value survives, and labels each union with its highest-precedence category.
func mergeSpans(spans []span) []span {
	valid := spans[:0]
	for _, s := range spans {
		if s.start >= 0 && s.start < s.end {
			valid = append(valid, s)
		}
	}
	if len(valid) == 0 {
		return nil
	}
	sort.SliceStable(valid, func(i, j int) bool { return valid[i].start < valid[j].start })

	merged := []span{valid[0]}
	for _, s := range valid[1:] {
		last := &merged[len(merged)-1]
		if s.start >= last.end {
			merged = append(merged, s)
			continue
		}
		if s.end > last.end {
			last.end = s.end
		}
		if categoryRank(s.category) < categoryRank(last.category) {
			last.category = s.category
		}
	}
	return merged
}

func categoryRank(c Category) int {
	for i, candidate := range categories {
		if candidate == c {
			return i
		}
	}
	return len(categories)
}
