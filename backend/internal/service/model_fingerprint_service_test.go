package service

import (
	"bufio"
	"context"
	"io"
	"strconv"
	"strings"
	"testing"
)

// requireFingerprintBank skips the test when the bundled reference data is absent
// (e.g. a checkout that only has the Go sources).
func requireFingerprintBank(t *testing.T) {
	t.Helper()
	if _, err := fingerprintDataDir(); err != nil {
		t.Skipf("reference bank unavailable: %v", err)
	}
}

func TestFingerprintBankLoadsBundledReferenceData(t *testing.T) {
	requireFingerprintBank(t)
	ResetModelFingerprintDetectorCache()
	t.Cleanup(ResetModelFingerprintDetectorCache)

	info, err := (&AccountTestService{}).GetModelFingerprintBank(context.Background())
	if err != nil {
		t.Fatalf("GetModelFingerprintBank: %v", err)
	}
	if info.BuiltAt == "" {
		t.Fatal("reference bank has no built_at")
	}
	if len(info.Models) < 50 {
		t.Fatalf("reference bank exposes %d models, want the full detector set", len(info.Models))
	}
	found := map[string]bool{}
	for _, model := range info.Models {
		if model.ID == "" || model.Family == "" {
			t.Fatalf("incomplete bank model entry: %+v", model)
		}
		found[model.ID] = true
	}
	if !found["gpt-6-sol"] || !found["claude-opus-5"] {
		t.Fatalf("expected well-known models in the bank, got %d entries", len(info.Models))
	}
}

// TestFingerprintAnalysisGates drives the bundled detector with hand-made replies
// and asserts the gates behave: program-like sequences are rejected before any
// ranking, and too-short replies are reported as unscorable.
func TestFingerprintAnalysisGates(t *testing.T) {
	requireFingerprintBank(t)
	ResetModelFingerprintDetectorCache()
	t.Cleanup(ResetModelFingerprintDetectorCache)

	svc := &AccountTestService{}
	sequential := make([]string, 0, 300)
	for i := 1; i <= 300; i++ {
		sequential = append(sequential, strconv.Itoa(i))
	}
	programLike := strings.Join(sequential, ", ")

	scored, err := svc.AnalyzeModelFingerprintTexts(context.Background(), []ModelFingerprintText{
		{Text: programLike, ExpectedCount: 300},
		{Text: programLike, ExpectedCount: 300},
		{Text: programLike, ExpectedCount: 300},
	})
	if err != nil {
		t.Fatalf("AnalyzeModelFingerprintTexts: %v", err)
	}
	if scored.Decision != ModelFingerprintDecisionNotModel {
		t.Fatalf("sequential 1..300 must be rejected as not_model, got %q", scored.Decision)
	}
	if len(scored.Candidates) != 0 {
		t.Fatalf("not_model must not produce a ranking, got %d candidates", len(scored.Candidates))
	}
	if scored.Sequence == nil || scored.Sequence.ModelLike {
		t.Fatalf("expected a model_like=false sequence diagnostic, got %+v", scored.Sequence)
	}

	short, err := svc.AnalyzeModelFingerprintTexts(context.Background(), []ModelFingerprintText{
		{Text: "12, 34, 56", ExpectedCount: 300},
	})
	if err != nil {
		t.Fatalf("AnalyzeModelFingerprintTexts(short): %v", err)
	}
	if short.Decision != ModelFingerprintDecisionUnscorable {
		t.Fatalf("three-number reply must be unscorable, got %q", short.Decision)
	}
	if short.UsedOutputs != 0 {
		t.Fatalf("used outputs = %d, want 0", short.UsedOutputs)
	}
}

func TestFingerprintMinimumNumbersMatchesSDKThreshold(t *testing.T) {
	for _, tc := range []struct {
		expected int
		want     int
	}{
		{292, 161},
		{300, 165},
		{332, 183},
		{100, 80},
	} {
		if got := fingerprintMinimumNumbers(tc.expected); got != tc.want {
			t.Fatalf("fingerprintMinimumNumbers(%d) = %d, want %d", tc.expected, got, tc.want)
		}
	}
}

func TestFingerprintClaimVerdict(t *testing.T) {
	for _, tc := range []struct {
		name       string
		requested  string
		prediction string
		comparable bool
		matches    bool
	}{
		{"exact", "gpt-6-sol", "gpt-6-sol", true, true},
		{"separator variant", "claude-sonnet-4.6", "claude-sonnet-4-6", true, true},
		{"provider prefix", "openai/gpt-6-luna", "gpt-6-luna", true, true},
		{"dated suffix", "gpt-5.6-sol-2026-01-01", "gpt-5.6-sol", true, true},
		{"different model", "gpt-6-sol", "deepseek-v4-pro", true, false},
		{"unknown requested", "", "gpt-6-sol", false, false},
	} {
		comparable, matches := fingerprintClaimVerdict(tc.requested, tc.prediction)
		if comparable != tc.comparable || matches != tc.matches {
			t.Fatalf("%s: got comparable=%v matches=%v, want %v/%v", tc.name, comparable, matches, tc.comparable, tc.matches)
		}
	}
}

func TestUniqueFingerprintModels(t *testing.T) {
	got := uniqueFingerprintModels([]string{"GPT-6-Sol", " gpt-6-sol ", "", "claude-opus-5"})
	if len(got) != 2 || got[0] != "GPT-6-Sol" || got[1] != "claude-opus-5" {
		t.Fatalf("uniqueFingerprintModels = %v", got)
	}
}

func TestRunModelFingerprintBatchRequiresTargets(t *testing.T) {
	requireFingerprintBank(t)
	ResetModelFingerprintDetectorCache()
	t.Cleanup(ResetModelFingerprintDetectorCache)

	report := (&AccountTestService{}).RunModelFingerprintBatch(context.Background(), ModelFingerprintOptions{})
	if len(report.Errors) == 0 {
		t.Fatal("expected an error for an empty batch")
	}
	if len(report.Results) != 0 {
		t.Fatalf("empty batch returned %d results", len(report.Results))
	}
}

// TestReadSSELineKeepsTrailingLineWithoutNewline guards the DeepSeek-style stream
// that terminates with "response.completed" and no trailing newline: dropping
// that line used to surface as "Stream ended before response.completed".
func TestReadSSELineKeepsTrailingLineWithoutNewline(t *testing.T) {
	body := "data: {\"type\":\"response.output_text.delta\",\"delta\":\"1, 2\"}\n\n" +
		"data: {\"type\":\"response.completed\"}"
	reader := bufio.NewReader(strings.NewReader(body))

	var lines []string
	for {
		line, err := readSSELine(reader)
		if strings.TrimSpace(line) != "" {
			lines = append(lines, strings.TrimSpace(line))
		}
		if err != nil {
			if err != io.EOF {
				t.Fatalf("unexpected error: %v", err)
			}
			break
		}
	}
	if len(lines) != 2 {
		t.Fatalf("read %d lines, want 2: %v", len(lines), lines)
	}
	if !strings.Contains(lines[1], "response.completed") {
		t.Fatalf("trailing line was dropped: %v", lines)
	}
}

func TestFingerprintRequestedInBank(t *testing.T) {
	requireFingerprintBank(t)
	for _, tc := range []struct {
		requested string
		inBank    bool
	}{
		{"gpt-6-sol", true},
		{"openai/gpt-6-luna", true},
		{"claude-sonnet-4-6", true},
		{"gpt-5.6-sol-2026-01-01", true},
		{"deepseek-chat", false},
		{"my-custom-alias", false},
		{"", false},
	} {
		inBank, canonical := fingerprintRequestedInBank(tc.requested)
		if inBank != tc.inBank {
			t.Fatalf("fingerprintRequestedInBank(%q) = %v (canonical %q), want %v", tc.requested, inBank, canonical, tc.inBank)
		}
	}
}
