package privacyfilter

import (
	_ "embed"
	"fmt"
	"math"
	"regexp"
	"strings"

	toml "github.com/pelletier/go-toml/v2"
)

// gitleaksRules is the default gitleaks ruleset (MIT licensed, see NOTICE).
//
//go:embed rules/gitleaks.toml
var gitleaksRules []byte

// privateKeyRuleID is handled by the dedicated private key detector, which also
// covers truncated blocks and honours the separate category switch.
const privateKeyRuleID = "private-key"

const genericRuleID = "generic-api-key"

type gitleaksAllowlist struct {
	Condition   string   `toml:"condition"`
	RegexTarget string   `toml:"regexTarget"`
	Regexes     []string `toml:"regexes"`
	Stopwords   []string `toml:"stopwords"`
	Paths       []string `toml:"paths"`
	Commits     []string `toml:"commits"`
}

type gitleaksFile struct {
	Allowlist  *gitleaksAllowlist  `toml:"allowlist"`
	Allowlists []gitleaksAllowlist `toml:"allowlists"`
	Rules      []struct {
		ID          string              `toml:"id"`
		Regex       string              `toml:"regex"`
		Keywords    []string            `toml:"keywords"`
		Entropy     float64             `toml:"entropy"`
		SecretGroup int                 `toml:"secretGroup"`
		Allowlists  []gitleaksAllowlist `toml:"allowlists"`
	} `toml:"rules"`
}

type allowlistMatcher struct {
	requireAll bool
	target     string
	regexes    []*regexp.Regexp
	stopwords  []string
}

// allows reports whether a detection should be discarded. Path and commit
// conditions have no meaning here, so builders drop or skip those entries.
func (a *allowlistMatcher) allows(secret, match, line string) bool {
	regexHit := false
	if len(a.regexes) > 0 {
		subject := secret
		switch a.target {
		case "match":
			subject = match
		case "line":
			subject = line
		}
		for _, re := range a.regexes {
			if re.MatchString(subject) {
				regexHit = true
				break
			}
		}
	}
	stopwordHit := false
	if len(a.stopwords) > 0 {
		lowered := strings.ToLower(secret)
		for _, word := range a.stopwords {
			if strings.Contains(lowered, word) {
				stopwordHit = true
				break
			}
		}
	}
	if a.requireAll {
		return (len(a.regexes) == 0 || regexHit) && (len(a.stopwords) == 0 || stopwordHit)
	}
	return regexHit || stopwordHit
}

func compileAllowlist(raw gitleaksAllowlist) (*allowlistMatcher, error) {
	requireAll := strings.EqualFold(raw.Condition, "AND")
	if requireAll && (len(raw.Paths) > 0 || len(raw.Commits) > 0) {
		// An AND with a path or commit condition can never be satisfied here.
		return nil, nil
	}
	if len(raw.Regexes) == 0 && len(raw.Stopwords) == 0 {
		return nil, nil
	}
	matcher := &allowlistMatcher{requireAll: requireAll, target: raw.RegexTarget}
	for _, pattern := range raw.Regexes {
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, fmt.Errorf("allowlist regex %q: %w", pattern, err)
		}
		matcher.regexes = append(matcher.regexes, re)
	}
	for _, word := range raw.Stopwords {
		matcher.stopwords = append(matcher.stopwords, strings.ToLower(word))
	}
	return matcher, nil
}

type secretRule struct {
	id          string
	re          *regexp.Regexp
	keywords    []string
	entropy     float64
	secretGroup int
	allowlists  []*allowlistMatcher
}

type secretRules struct {
	rules  []secretRule
	global []*allowlistMatcher
}

func loadSecretRules() (*secretRules, error) {
	var file gitleaksFile
	if err := toml.Unmarshal(gitleaksRules, &file); err != nil {
		return nil, err
	}
	loaded := &secretRules{}
	globals := file.Allowlists
	if file.Allowlist != nil {
		globals = append(globals, *file.Allowlist)
	}
	for _, raw := range globals {
		matcher, err := compileAllowlist(raw)
		if err != nil {
			return nil, err
		}
		if matcher != nil {
			loaded.global = append(loaded.global, matcher)
		}
	}
	for _, raw := range file.Rules {
		if raw.Regex == "" || raw.ID == privateKeyRuleID {
			continue
		}
		re, err := regexp.Compile(raw.Regex)
		if err != nil {
			return nil, fmt.Errorf("rule %s: %w", raw.ID, err)
		}
		rule := secretRule{id: raw.ID, re: re, entropy: raw.Entropy, secretGroup: raw.SecretGroup}
		for _, keyword := range raw.Keywords {
			rule.keywords = append(rule.keywords, strings.ToLower(keyword))
		}
		for _, allow := range raw.Allowlists {
			matcher, err := compileAllowlist(allow)
			if err != nil {
				return nil, fmt.Errorf("rule %s: %w", raw.ID, err)
			}
			if matcher != nil {
				rule.allowlists = append(rule.allowlists, matcher)
			}
		}
		loaded.rules = append(loaded.rules, rule)
	}
	if len(loaded.rules) == 0 {
		return nil, fmt.Errorf("embedded ruleset has no rules")
	}
	return loaded, nil
}

func (r *secretRules) appendSpans(spans []span, text string) []span {
	lowered := strings.ToLower(text)
	for i := range r.rules {
		rule := &r.rules[i]
		if !rule.applies(lowered) {
			continue
		}
		for _, m := range rule.re.FindAllStringSubmatchIndex(text, -1) {
			start, end := secretBounds(m, rule.secretGroup)
			if start < 0 || start >= end {
				continue
			}
			secret := text[start:end]
			if rule.entropy > 0 && shannonEntropy(secret) < rule.entropy {
				continue
			}
			if r.isAllowed(rule, text, secret, m[0], m[1]) {
				continue
			}
			spans = append(spans, span{start, end, CategoryCredential})
		}
	}
	return spans
}

func (r *secretRule) applies(lowered string) bool {
	if len(r.keywords) == 0 {
		return true
	}
	for _, keyword := range r.keywords {
		if strings.Contains(lowered, keyword) {
			return true
		}
	}
	return false
}

// secretBounds follows gitleaks: the explicit secret group when set, otherwise
// the first capture group that took part in the match, otherwise the full match.
func secretBounds(m []int, secretGroup int) (int, int) {
	if secretGroup > 0 && 2*secretGroup+1 < len(m) && m[2*secretGroup] >= 0 {
		return m[2*secretGroup], m[2*secretGroup+1]
	}
	for group := 1; 2*group+1 < len(m); group++ {
		if m[2*group] >= 0 && m[2*group+1] > m[2*group] {
			return m[2*group], m[2*group+1]
		}
	}
	return m[0], m[1]
}

func (r *secretRules) isAllowed(rule *secretRule, text, secret string, matchStart, matchEnd int) bool {
	match := text[matchStart:matchEnd]
	line := lineAround(text, matchStart, matchEnd)
	for _, allow := range rule.allowlists {
		if allow.allows(secret, match, line) {
			return true
		}
	}
	for _, allow := range r.global {
		if allow.allows(secret, match, line) {
			return true
		}
	}
	if isPlaceholderValue(secret) {
		return true
	}
	if rule.id != genericRuleID {
		return false
	}
	// The generic rule fires on any "key = value" shape; these are the shapes in
	// source code and configs that are visibly not secrets.
	return reUUID.MatchString(secret) || isHexDigest(secret) || rePublicKeyName.MatchString(match)
}

func lineAround(text string, start, end int) string {
	lineStart := strings.LastIndexByte(text[:start], '\n') + 1
	lineEnd := len(text)
	if offset := strings.IndexByte(text[end:], '\n'); offset >= 0 {
		lineEnd = end + offset
	}
	return text[lineStart:lineEnd]
}

var (
	reUUID          = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	reHexOnly       = regexp.MustCompile(`^[0-9a-fA-F]+$`)
	rePublicKeyName = regexp.MustCompile(`(?i)public[-_ ]?key|pubkey|\bpbk\b`)
)

// isHexDigest matches md5, sha1 and sha256 digests.
func isHexDigest(s string) bool {
	n := len(s)
	return (n == 32 || n == 40 || n == 64) && reHexOnly.MatchString(s)
}

func shannonEntropy(s string) float64 {
	if s == "" {
		return 0
	}
	var freq [256]float64
	for i := 0; i < len(s); i++ {
		freq[s[i]]++
	}
	total := float64(len(s))
	entropy := 0.0
	for _, count := range freq {
		if count > 0 {
			p := count / total
			entropy -= p * math.Log2(p)
		}
	}
	return entropy
}
