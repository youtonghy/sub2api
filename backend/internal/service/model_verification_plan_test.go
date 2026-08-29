package service

import "testing"

func TestBuildVerificationPlanOfficialCounts(t *testing.T) {
	for _, tc := range []struct {
		level string
		want  int
	}{{"low", 19}, {"medium", 49}, {"high", 158}} {
		if got := len(buildVerificationPlan(tc.level)); got != tc.want {
			t.Fatalf("%s plan has %d jobs, want %d", tc.level, got, tc.want)
		}
	}
	for _, item := range buildVerificationPlan("medium") {
		if item.ID == "juice_budget" && item.Effort == "medium" {
			t.Fatal("medium plan must reserve upstream medium effort only in high/custom contracts")
		}
	}
	high := buildVerificationPlan("high")
	counts := map[string]int{}
	for _, item := range high {
		counts[item.ID+"|"+item.Profile]++
	}
	if counts["b80_letter_count|normal+no_history"] != 10 {
		t.Fatal("high b80 normal/no-history count must be 10")
	}
	for _, profile := range []string{"normal+fixed_32k_history", "native_codex+no_history", "native_codex+fixed_32k_history"} {
		if counts["b80_letter_count|"+profile] != 0 {
			t.Fatalf("high b80 must not run in %s", profile)
		}
	}
	for _, profile := range []string{"normal+no_history", "normal+fixed_32k_history", "native_codex+no_history", "native_codex+fixed_32k_history"} {
		if counts["juice_budget|"+profile] != 13 || counts["rand_country|"+profile] != 10 || counts["rand_bird|"+profile] != 10 {
			t.Fatalf("unexpected high profile distribution for %s", profile)
		}
	}
}

func TestNormalizeVerificationCategory(t *testing.T) {
	if got := normalizeVerificationCategory("b80_letter_count", "3"); got != "exact_3" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeVerificationCategory("b80_letter_count", "4"); got != "other_integer" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeVerificationCategory("b80_letter_count", "three"); got != "__INVALID_OUTPUT__" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeVerificationCategory("rand_bird", "Kingfisher\n"); got != "kingfisher" {
		t.Fatalf("got %q", got)
	}
}

func TestNumericOnly(t *testing.T) {
	if !numericOnly("40855") || numericOnly("40 words") || numericOnly("") {
		t.Fatal("numericOnly classification mismatch")
	}
}
