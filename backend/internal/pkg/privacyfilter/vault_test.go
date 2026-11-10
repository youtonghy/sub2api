package privacyfilter

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVaultTokensAreDeterministicPerKey(t *testing.T) {
	a1, a2, b := NewVault([]byte("key-a")), NewVault([]byte("key-a")), NewVault([]byte("key-b"))
	token := a1.Token(CategoryCredential, "Hunter2xy")
	require.Equal(t, token, a2.Token(CategoryCredential, "Hunter2xy"))
	require.NotEqual(t, token, b.Token(CategoryCredential, "Hunter2xy"))
	require.Regexp(t, `^\[REDACTED:credential:[0-9a-f]{8}\]$`, token)
	require.Equal(t, token, a1.Token(CategoryFinancial, "Hunter2xy"), "a value keeps its first placeholder")
	require.Equal(t, 1, a1.Len())
}

func TestVaultCollisionLengthensSuffix(t *testing.T) {
	v := NewVault([]byte("k"))
	first := v.Token(CategoryCredential, "one")
	suffix := first[strings.LastIndexByte(first, ':')+1 : len(first)-1]
	v.byHash[suffix] = "someone else"
	delete(v.byValue, "one")
	second := v.Token(CategoryCredential, "one")
	require.Len(t, second[strings.LastIndexByte(second, ':')+1:len(second)-1], 12)
}

func TestVaultRoundTrip(t *testing.T) {
	d := testDetector(t)
	v := NewVault([]byte("k"))
	input := `password: abc12345 and "quote\" key" card 4111111111111111`
	redacted := v.RedactMatches(input, d.Detect(input, NewCategorySet(DefaultCategories()...)))
	require.True(t, redacted.Changed)
	require.NotContains(t, redacted.Text, "abc12345")
	require.Equal(t, input, v.Restore(redacted.Text))

	again, changed := v.ReplaceKnown(input, false)
	require.True(t, changed)
	require.Equal(t, redacted.Text, again, "ReplaceKnown is the inverse of Restore")

	restored, unresolved := v.Stats()
	require.EqualValues(t, 2, restored)
	require.Zero(t, unresolved)
}

func TestVaultRestoreToleratesCaseAndCountsUnknown(t *testing.T) {
	v := NewVault([]byte("k"))
	token := v.Token(CategoryCredential, "abc12345")
	require.Equal(t, "x abc12345 y", v.Restore("x "+strings.ToUpper(token)+" y"))
	require.Equal(t, "[REDACTED:credential:deadbeef]", v.Restore("[REDACTED:credential:deadbeef]"))
	_, unresolved := v.Stats()
	require.EqualValues(t, 1, unresolved)
	require.Equal(t, "[REDACTED:credential]", v.Restore("[REDACTED:credential]"), "irreversible placeholders stay")
}

func TestVaultJSONForms(t *testing.T) {
	v := NewVault([]byte("k"))
	value := `p"a\ss	1`
	token := v.Token(CategoryCredential, value)
	argumentsJSON := `{"cmd":"login ` + EscapeJSONText(value) + `"}`
	replaced, changed := v.ReplaceKnownJSON(argumentsJSON)
	require.True(t, changed)
	require.Equal(t, `{"cmd":"login `+token+`"}`, replaced)
	require.Equal(t, argumentsJSON, v.RestoreJSON(replaced))
}

func TestVaultReplaceKnownSkipsTokensAndShortUserValues(t *testing.T) {
	v := NewVault([]byte("k"))
	short := v.Token(CategoryCredential, "1234")
	long := v.Token(CategoryCredential, "abcd1234efgh")

	out, _ := v.ReplaceKnown("pin 1234, key abcd1234efgh", true)
	require.Equal(t, "pin 1234, key "+long, out)
	out, _ = v.ReplaceKnown("pin 1234, key abcd1234efgh", false)
	require.Equal(t, "pin "+short+", key "+long, out)

	// A value that happens to look like part of an existing placeholder must
	// not corrupt it.
	hexValue := long[strings.LastIndexByte(long, ':')+1 : strings.LastIndexByte(long, ':')+5]
	v.Token(CategoryCredential, hexValue)
	out, _ = v.ReplaceKnown(long, false)
	require.Equal(t, long, out)
}

func TestVaultSizeLimit(t *testing.T) {
	v := NewVault([]byte("k"))
	for i := 0; i < maxVaultEntries; i++ {
		v.byValue[strings.Repeat("x", 1)+string(rune(i+0x4e00))] = "t"
	}
	token := v.Token(CategoryCredential, "overflow-value")
	require.Contains(t, token, "[REDACTED:credential:")
	require.Equal(t, maxVaultEntries, v.Len())
}

func TestStreamRestorerHandlesEverySplit(t *testing.T) {
	v := NewVault([]byte("k"))
	token := v.Token(CategoryCredential, "abc12345")
	other := v.Token(CategoryFinancial, "4111111111111111")
	text := "a[b] " + token + " [REDACT " + other + "[end"
	want := v.Restore(text)
	for i := 0; i <= len(text); i++ {
		for j := i; j <= len(text); j++ {
			s := v.NewStream(false)
			got := s.Push(text[:i]) + s.Push(text[i:j]) + s.Push(text[j:]) + s.Flush()
			require.Equal(t, want, got, "split at %d,%d", i, j)
		}
	}
}

func TestStreamRestorerJSONAndOneByteFeed(t *testing.T) {
	v := NewVault([]byte("k"))
	token := v.Token(CategoryCredential, `q"uote`)
	text := `{"a":"` + token + `"}`
	s := v.NewStream(true)
	var b strings.Builder
	for i := 0; i < len(text); i++ {
		b.WriteString(s.Push(text[i : i+1]))
	}
	b.WriteString(s.Flush())
	require.Equal(t, `{"a":"q\"uote"}`, b.String())
	require.False(t, s.Pending())
}

func TestStreamRestorerReleasesNonTokens(t *testing.T) {
	s := NewVault([]byte("k")).NewStream(false)
	require.Equal(t, "x ", s.Push("x [RED"))
	require.True(t, s.Pending())
	require.Equal(t, "[REDUCED", s.Push("UCED"))
	require.Equal(t, "arr[0] ", s.Push("arr[0] "))
	require.Equal(t, "", s.Push("[REDACTED:credential:"+strings.Repeat("a", 64)))
	require.Equal(t, "[REDACTED:credential:"+strings.Repeat("a", 64)+"a", s.Push("a"))
}

func FuzzStreamRestorer(f *testing.F) {
	v := NewVault([]byte("k"))
	token := v.Token(CategoryCredential, "abc12345")
	f.Add("before "+token+" after", 3, 9)
	f.Add("[[REDACTED:"+token, 1, 2)
	f.Fuzz(func(t *testing.T, text string, a, b int) {
		if a < 0 {
			a = -a
		}
		if b < 0 {
			b = -b
		}
		i, j := a%(len(text)+1), b%(len(text)+1)
		if i > j {
			i, j = j, i
		}
		s := v.NewStream(false)
		got := s.Push(text[:i]) + s.Push(text[i:j]) + s.Push(text[j:]) + s.Flush()
		if got != v.Restore(text) {
			t.Fatalf("got %q want %q", got, v.Restore(text))
		}
	})
}
