package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	lmfpd "github.com/Ikaleio/lm-detector/sdk/go"
	"github.com/gin-gonic/gin"
)

// 模型指纹检测（lm-detector / lmfpd）。
//
// 原理：让模型"凭第一反应"写出约 300 个 1..355 的整数，把这串数字的分布
// 与参考库里 64 个模型的取样比对，给出最接近的候选与闭集置信度。
// 结论只在参考库内排序，不是身份证明。
//
// 与上游的耦合只有一件事：把 challenge prompt 发给账号、取回纯文本。
// 因此这里复用 AccountTestService 的探针通道（已覆盖 OAuth / API Key /
// 各平台协议 / 代理 / TLS 指纹），不重新实现上游调用。

const (
	// ModelFingerprintDecisionScored 三份有效样本，带校准置信度。
	ModelFingerprintDecisionScored = "scored"
	// ModelFingerprintDecisionPartial 样本不足三份，只有排名没有置信度。
	ModelFingerprintDecisionPartial = "partial"
	// ModelFingerprintDecisionUnscorable 有效样本不足（或超过三份）。
	ModelFingerprintDecisionUnscorable = "unscorable"
	// ModelFingerprintDecisionNotModel 数字序列的统计特征不像语言模型输出。
	ModelFingerprintDecisionNotModel = "not_model"
	// ModelFingerprintDecisionError 请求层面失败，没有可判分的输出。
	ModelFingerprintDecisionError = "error"

	// ModelFingerprintDefaultRounds 默认轮数。三份有效样本才给置信度。
	ModelFingerprintDefaultRounds = 3
	// ModelFingerprintMaxRounds 单次检测最多轮数（SDK 上限）。
	ModelFingerprintMaxRounds = 3
	// ModelFingerprintDefaultConcurrency 同一批次内并发检测的组合数。
	ModelFingerprintDefaultConcurrency = 2
	// ModelFingerprintMaxConcurrency 并发上限，避免把上游打爆。
	ModelFingerprintMaxConcurrency = 4
	// modelFingerprintMaxOutputTokens 给模型的输出预算，~300 个整数足够。
	modelFingerprintMaxOutputTokens = 4096
	// modelFingerprintProbeTimeout 单轮挑战（含重试）的超时。
	modelFingerprintProbeTimeout = 5 * time.Minute
	// modelFingerprintProbeAttempts 单轮挑战的最大尝试次数；上游长输出常被截断。
	modelFingerprintProbeAttempts = 3
	// modelFingerprintPreviewLimit 结果里保留的原始文本长度上限。
	modelFingerprintPreviewLimit = 240
)

// ErrModelFingerprintDataUnavailable 参考库缺失或与检测器不匹配。
var ErrModelFingerprintDataUnavailable = errors.New("model fingerprint reference data is unavailable")

// ModelFingerprintCandidate 一个参考库候选及其排名分数/概率。
type ModelFingerprintCandidate struct {
	Model       string   `json:"model"`
	DisplayName string   `json:"display_name"`
	Family      string   `json:"family"`
	FamilyName  string   `json:"family_name"`
	Score       float64  `json:"score"`
	Probability *float64 `json:"probability,omitempty"`
}

// ModelFingerprintSample 一轮挑战的结果，只保留判定所需的元数据与一小段预览。
type ModelFingerprintSample struct {
	Index          int    `json:"index"`
	ExpectedCount  int    `json:"expected_count"`
	Status         string `json:"status"`
	ParsedNumbers  int    `json:"parsed_numbers"`
	MinimumNumbers int    `json:"minimum_numbers"`
	Accepted       bool   `json:"accepted"`
	LatencyMs      int64  `json:"latency_ms"`
	Preview        string `json:"preview,omitempty"`
	Error          string `json:"error,omitempty"`
}

// ModelFingerprintSequence 数字序列的形态学证据（识别程序生成/乱写的输出）。
type ModelFingerprintSequence struct {
	Autocorrelation float64 `json:"autocorrelation"`
	SmallStepShare  float64 `json:"small_step_share"`
	ModelLike       bool    `json:"model_like"`
}

// ModelFingerprintResult 一个 (账号, 模型) 组合的检测结论。
type ModelFingerprintResult struct {
	AccountID   int64  `json:"account_id"`
	AccountName string `json:"account_name,omitempty"`
	Platform    string `json:"platform,omitempty"`
	// ModelID 是实际请求的上游模型名（可能经过 model_mapping）。
	ModelID        string `json:"model_id"`
	RequestedModel string `json:"requested_model,omitempty"`
	// Decision 见 ModelFingerprintDecision* 常量。
	Decision         string   `json:"decision"`
	Prediction       string   `json:"prediction,omitempty"`
	PredictionName   string   `json:"prediction_name,omitempty"`
	FamilyPrediction string   `json:"family_prediction,omitempty"`
	FamilyName       string   `json:"family_name,omitempty"`
	RankingScore     *float64 `json:"ranking_score,omitempty"`
	// Probability 是闭集置信度：仅在三份有效样本且校准匹配时存在。
	Probability *float64 `json:"probability,omitempty"`
	// MatchesClaim 表示最像的模型与我们请求的模型一致（含别名归一）。
	MatchesClaim bool `json:"matches_claim"`
	// ClaimComparable 为 false 表示请求的模型不在参考库内，无法比对声称。
	ClaimComparable bool `json:"claim_comparable"`
	UsedOutputs     int  `json:"used_outputs"`
	RequestedRounds int  `json:"requested_rounds"`

	Candidates  []ModelFingerprintCandidate `json:"candidates,omitempty"`
	Samples     []ModelFingerprintSample    `json:"samples"`
	Sequence    *ModelFingerprintSequence   `json:"sequence,omitempty"`
	Method      string                      `json:"method,omitempty"`
	BankBuiltAt string                      `json:"bank_built_at,omitempty"`
	Evidence    string                      `json:"evidence,omitempty"`
	Error       string                      `json:"error,omitempty"`
	TestedAt    time.Time                   `json:"tested_at"`
}

// ModelFingerprintReport 一次批量检测的汇总。
type ModelFingerprintReport struct {
	StartedAt   time.Time                `json:"started_at"`
	FinishedAt  time.Time                `json:"finished_at,omitempty"`
	Rounds      int                      `json:"rounds"`
	BankBuiltAt string                   `json:"bank_built_at,omitempty"`
	BankModels  []string                 `json:"bank_models,omitempty"`
	Results     []ModelFingerprintResult `json:"results"`
	Errors      []string                 `json:"errors,omitempty"`
}

// ModelFingerprintProgress 批量检测的进度快照。
type ModelFingerprintProgress struct {
	Total     int `json:"total"`
	Completed int `json:"completed"`
	// Matched 是最像的模型与请求模型一致的组合数。
	Matched int `json:"matched"`
}

// ModelFingerprintOptions 批量检测参数。
type ModelFingerprintOptions struct {
	AccountIDs  []int64
	ModelIDs    []string
	Rounds      int
	Concurrency int
	// OnProgress 在每个组合完成后回调（可为 nil）。
	OnProgress func(ModelFingerprintProgress)
}

// ModelFingerprintBankModel 参考库内的一个模型。
type ModelFingerprintBankModel struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Family      string `json:"family"`
	FamilyName  string `json:"family_name"`
}

// ModelFingerprintBankInfo 参考库信息，供前端展示版本与候选清单。
type ModelFingerprintBankInfo struct {
	BuiltAt string                      `json:"built_at"`
	Schema  string                      `json:"schema"`
	Models  []ModelFingerprintBankModel `json:"models"`
}

// ModelFingerprintText 是一份待判分的模型回复。
type ModelFingerprintText struct {
	Text          string
	ExpectedCount int
}

// detectorBundle 是本进程共享的检测器（参考库 ~4.5MB，只解一次）。
type detectorBundle struct {
	once     sync.Once
	detector *lmfpd.Detector
	err      error
}

var sharedFingerprintDetector detectorBundle

// ResetModelFingerprintDetectorCache 清空已加载的检测器（测试用）。
func ResetModelFingerprintDetectorCache() {
	sharedFingerprintDetector = detectorBundle{}
}

// fingerprintDataDirCandidates 列出内置参考库可能的位置。
//
// 生产容器里固定是 /app/resources/lm_detector；源码树里资源在 backend/resources，
// 而 `go test` 的工作目录是被测包目录，所以还要靠 runtime.Caller 回溯到模块根。
func fingerprintDataDirCandidates() []string {
	candidates := []string{"/app/resources/lm_detector"}
	if _, file, _, ok := runtime.Caller(0); ok && filepath.IsAbs(file) {
		// <module>/internal/service/model_fingerprint_service.go → <module>/resources/lm_detector
		candidates = append(candidates, filepath.Join(filepath.Dir(file), "..", "..", "resources", "lm_detector"))
	}
	candidates = append(candidates,
		filepath.Join("backend", "resources", "lm_detector"),
		filepath.Join("resources", "lm_detector"),
	)
	return candidates
}

// fingerprintDataDir 返回内置参考库目录（需同时存在 bank 与 detector 两个文件）。
func fingerprintDataDir() (string, error) {
	candidates := fingerprintDataDirCandidates()
	for _, dir := range candidates {
		if _, err := os.Stat(filepath.Join(dir, "shared_detector.bin")); err != nil {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, "unified_bank.json")); err != nil {
			continue
		}
		return dir, nil
	}
	return "", fmt.Errorf("%w: looked in %s", ErrModelFingerprintDataUnavailable, strings.Join(candidates, ", "))
}

// loadFingerprintDetector 懒加载参考库。失败结果会被缓存（只可能是镜像缺文件），
// 避免每次检测都去扫盘。
func loadFingerprintDetector(ctx context.Context) (*lmfpd.Detector, error) {
	sharedFingerprintDetector.once.Do(func() {
		dir, err := fingerprintDataDir()
		if err != nil {
			sharedFingerprintDetector.err = err
			return
		}
		detector, loadErr := lmfpd.Load(ctx, lmfpd.LoadOptions{Sources: []string{dir}})
		if loadErr != nil {
			sharedFingerprintDetector.err = fmt.Errorf("%w: %v", ErrModelFingerprintDataUnavailable, loadErr)
			return
		}
		sharedFingerprintDetector.detector = detector
	})
	return sharedFingerprintDetector.detector, sharedFingerprintDetector.err
}

// bankMetadataFile 是 bundle.json 的镜像结构（只取展示需要的字段）。
type bankMetadataFile struct {
	BuiltAt string `json:"built_at"`
	Schema  any    `json:"schema"`
	Models  []struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
		Family      string `json:"family"`
		FamilyName  string `json:"family_name"`
	} `json:"models"`
}

// readFingerprintBankModels 读取参考库的模型清单。
// SDK 只在 Analyze 结果里暴露候选，没有独立的清单访问器，因此直接读 bank 文件。
func readFingerprintBankModels() ([]ModelFingerprintBankModel, error) {
	dir, err := fingerprintDataDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "unified_bank.json"))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrModelFingerprintDataUnavailable, err)
	}
	var metadata bankMetadataFile
	if err := json.Unmarshal(data, &metadata); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrModelFingerprintDataUnavailable, err)
	}
	models := make([]ModelFingerprintBankModel, 0, len(metadata.Models))
	for _, model := range metadata.Models {
		if strings.TrimSpace(model.ID) == "" {
			continue
		}
		models = append(models, ModelFingerprintBankModel{
			ID:          model.ID,
			DisplayName: model.DisplayName,
			Family:      model.Family,
			FamilyName:  model.FamilyName,
		})
	}
	return models, nil
}

// GetModelFingerprintBank 返回参考库版本与候选模型清单。
func (s *AccountTestService) GetModelFingerprintBank(ctx context.Context) (*ModelFingerprintBankInfo, error) {
	detector, err := loadFingerprintDetector(ctx)
	if err != nil {
		return nil, err
	}
	models, err := readFingerprintBankModels()
	if err != nil {
		return nil, err
	}
	return &ModelFingerprintBankInfo{
		BuiltAt: detector.BuiltAt(),
		Schema:  "shared-detector-v2",
		Models:  models,
	}, nil
}

// AnalyzeModelFingerprintTexts 用已保存的模型回复判分（不发起上游请求）。
func (s *AccountTestService) AnalyzeModelFingerprintTexts(ctx context.Context, outputs []ModelFingerprintText) (*ModelFingerprintResult, error) {
	detector, err := loadFingerprintDetector(ctx)
	if err != nil {
		return nil, err
	}
	if len(outputs) == 0 {
		return nil, errors.New("at least one output is required")
	}
	sdkOutputs := make([]lmfpd.Output, 0, len(outputs))
	for _, output := range outputs {
		sdkOutputs = append(sdkOutputs, lmfpd.Output{Text: output.Text, ExpectedCount: output.ExpectedCount})
	}
	analysis, err := detector.Analyze(sdkOutputs, false)
	if err != nil {
		return nil, err
	}
	result := &ModelFingerprintResult{
		ModelID:          "",
		Decision:         analysis.Decision,
		Prediction:       analysis.Prediction,
		PredictionName:   analysis.PredictionName,
		FamilyPrediction: analysis.FamilyPrediction,
		FamilyName:       analysis.FamilyPredictionName,
		RankingScore:     analysis.RankingScore,
		Probability:      analysis.Probability,
		UsedOutputs:      analysis.UsedOutputs,
		RequestedRounds:  len(outputs),
		Method:           analysis.Method,
		BankBuiltAt:      detector.BuiltAt(),
		Evidence:         analysis.Evidence.Label,
		TestedAt:         time.Now().UTC(),
	}
	applyFingerprintAnalysis(result, analysis)
	return result, nil
}

// applyFingerprintAnalysis 把 SDK 的 Analysis 归一化进结果结构。
func applyFingerprintAnalysis(result *ModelFingerprintResult, analysis *lmfpd.Analysis) {
	if analysis == nil {
		return
	}
	result.Decision = analysis.Decision
	result.Prediction = analysis.Prediction
	result.PredictionName = analysis.PredictionName
	result.FamilyPrediction = analysis.FamilyPrediction
	result.FamilyName = analysis.FamilyPredictionName
	result.RankingScore = analysis.RankingScore
	result.Probability = analysis.Probability
	result.UsedOutputs = analysis.UsedOutputs
	result.Method = analysis.Method
	result.Evidence = analysis.Evidence.Label
	if analysis.Sequence != nil {
		result.Sequence = &ModelFingerprintSequence{
			Autocorrelation: analysis.Sequence.Autocorrelation,
			SmallStepShare:  analysis.Sequence.SmallStepShare,
			ModelLike:       analysis.Sequence.ModelLike,
		}
	}
	result.Candidates = make([]ModelFingerprintCandidate, 0, len(analysis.Results))
	for _, candidate := range analysis.Results {
		result.Candidates = append(result.Candidates, ModelFingerprintCandidate{
			Model:       candidate.Model,
			DisplayName: candidate.DisplayName,
			Family:      candidate.Family,
			FamilyName:  candidate.FamilyName,
			Score:       candidate.Score,
			Probability: candidate.Probability,
		})
	}
}

// DetectForAccount 对一个账号 + 模型跑一轮完整检测。
// 轮询流程与 SDK 的 Detect 一致，但上游请求走本项目的探针通道（凭据、代理、
// 协议、TLS 指纹全部沿用现有实现）。
func (s *AccountTestService) DetectForAccount(ctx context.Context, accountID int64, modelID string, rounds int) (*ModelFingerprintResult, error) {
	detector, err := loadFingerprintDetector(ctx)
	if err != nil {
		return nil, err
	}
	account, err := s.accountRepo.GetByID(ctx, accountID)
	if err != nil || account == nil {
		return nil, ErrAccountNotFound
	}

	if rounds <= 0 {
		rounds = ModelFingerprintDefaultRounds
	}
	if rounds > ModelFingerprintMaxRounds {
		rounds = ModelFingerprintMaxRounds
	}

	challenges, err := lmfpd.GenerateChallenges(rounds)
	if err != nil {
		return nil, err
	}

	requestedModel := strings.TrimSpace(modelID)
	if requestedModel == "" {
		requestedModel = account.providerDefaultTestModel()
	}
	upstreamModel := account.GetMappedModel(requestedModel)

	result := &ModelFingerprintResult{
		AccountID:       account.ID,
		AccountName:     account.Name,
		Platform:        account.Platform,
		ModelID:         upstreamModel,
		RequestedModel:  requestedModel,
		RequestedRounds: rounds,
		BankBuiltAt:     detector.BuiltAt(),
		TestedAt:        time.Now().UTC(),
		Samples:         make([]ModelFingerprintSample, 0, len(challenges)),
	}

	outputs := make([]lmfpd.Output, 0, len(challenges))
	for index, challenge := range challenges {
		sample, text := s.runFingerprintChallenge(ctx, account.ID, upstreamModel, challenge)
		sample.Index = index
		result.Samples = append(result.Samples, sample)
		if sample.Accepted {
			outputs = append(outputs, lmfpd.Output{Text: text, ExpectedCount: challenge.ExpectedCount})
		}
	}

	if len(outputs) == 0 {
		result.Decision = ModelFingerprintDecisionError
		result.Error = "no usable reply: every challenge failed or returned too few numbers in 1..355"
		return result, nil
	}

	analysis, err := detector.Analyze(outputs, false)
	if err != nil {
		result.Decision = ModelFingerprintDecisionError
		result.Error = err.Error()
		return result, nil
	}
	applyFingerprintAnalysis(result, analysis)
	// 只有"请求的模型在参考库内"才谈得上比对声称与实际。
	// 库外模型（例如供应商自定义别名）只能给出最像的候选，标成不可比对，
	// 避免把别名解析差异误报成"模型被换"。
	inBank, canonicalRequested := fingerprintRequestedInBank(requestedModel)
	if inBank {
		result.ClaimComparable, result.MatchesClaim = fingerprintClaimVerdict(canonicalRequested, analysis.Prediction)
	} else {
		result.ClaimComparable, result.MatchesClaim = false, false
	}
	return result, nil
}

// runFingerprintChallenge 发送一轮挑战，返回样本元数据与用于判分的原始文本。
func (s *AccountTestService) runFingerprintChallenge(ctx context.Context, accountID int64, modelID string, challenge lmfpd.Challenge) (ModelFingerprintSample, string) {
	sample := ModelFingerprintSample{
		ExpectedCount:  challenge.ExpectedCount,
		MinimumNumbers: fingerprintMinimumNumbers(challenge.ExpectedCount),
		Status:         "failed",
	}
	started := time.Now()
	probeCtx, cancel := context.WithTimeout(ctx, modelFingerprintProbeTimeout)
	defer cancel()

	// 长数字列表对上游是压力测试：中转/兼容端点经常提前断流或截断。
	// 与旧探针一致地重试，避免把"上游抖动"记成"模型不像模型"。
	var (
		bestText   string
		bestParsed int
		lastErr    string
	)
	for attempt := 1; attempt <= modelFingerprintProbeAttempts; attempt++ {
		text, errMsg := s.runFingerprintProbe(probeCtx, accountID, modelID, challenge.Prompt)
		if probeCtx.Err() == context.DeadlineExceeded {
			sample.Status = "timeout"
			sample.Error = "challenge timed out"
			break
		}
		numbers := lmfpd.ParseNumbers(text)
		if len(numbers) >= sample.MinimumNumbers {
			bestText, bestParsed, lastErr = text, len(numbers), ""
			break
		}
		if len(numbers) > bestParsed {
			bestText, bestParsed = text, len(numbers)
		}
		if errMsg != "" {
			lastErr = errMsg
		} else {
			lastErr = fmt.Sprintf("only %d numbers in 1..355, need at least %d", len(numbers), sample.MinimumNumbers)
		}
		if probeCtx.Err() != nil {
			break
		}
	}
	sample.LatencyMs = time.Since(started).Milliseconds()
	sample.Preview = fingerprintPreview(bestText)
	sample.ParsedNumbers = bestParsed
	sample.Accepted = bestParsed >= sample.MinimumNumbers
	if sample.Accepted {
		sample.Status = "success"
		return sample, bestText
	}
	sample.Status = "failed"
	sample.Error = lastErr
	if sample.Error == "" {
		sample.Error = fmt.Sprintf("only %d numbers in 1..355, need at least %d", bestParsed, sample.MinimumNumbers)
	}
	return sample, bestText
}

// fingerprintMinimumNumbers 与 SDK 的接受门槛一致：max(80, ceil(expected*0.55))。
func fingerprintMinimumNumbers(expected int) int {
	minimum := expected * 55 / 100
	if expected*55%100 != 0 {
		minimum++
	}
	if minimum < 80 {
		minimum = 80
	}
	return minimum
}

// fingerprintPreview 截取回复开头，供管理员确认模型到底回了什么。
func fingerprintPreview(text string) string {
	trimmed := strings.TrimSpace(text)
	if len(trimmed) <= modelFingerprintPreviewLimit {
		return trimmed
	}
	return trimmed[:modelFingerprintPreviewLimit] + "…"
}

// fingerprintRequestedInBank 判断请求的模型名能否对应参考库里的某个条目。
// 命中时返回库内规范名，便于后续用同一套归一规则比较。
// 库外模型（供应商自定义别名、日期版本等）返回 false：此时"最像的模型"
// 仍然有参考价值，但不能据此判定"声称与实际不符"。
func fingerprintRequestedInBank(requestedModel string) (bool, string) {
	models, err := readFingerprintBankModels()
	if err != nil || len(models) == 0 {
		return false, ""
	}
	requested := normalizeFingerprintModelSpelling(requestedModel)
	if requested == "" {
		return false, ""
	}
	collapse := func(value string) string {
		return strings.NewReplacer("-", "", "_", "", ".", "", " ", "").Replace(value)
	}
	requestedCollapsed := collapse(requested)
	for _, model := range models {
		candidate := normalizeFingerprintModelSpelling(model.ID)
		if candidate == requested {
			return true, model.ID
		}
		candidateCollapsed := collapse(candidate)
		if candidateCollapsed == requestedCollapsed {
			return true, model.ID
		}
		// 别名后缀/前缀（例如 gpt-6-astra 在库里就叫这个名字，而请求可能是
		// gpt-6-astra-2026-01-01）也算同一模型，但要求较短的那个足够长，
		// 避免 "gpt-5" 之类前缀把多个条目一起匹配掉。
		shorter := min(len(candidateCollapsed), len(requestedCollapsed))
		if shorter >= 6 && (strings.HasPrefix(candidateCollapsed, requestedCollapsed) || strings.HasPrefix(requestedCollapsed, candidateCollapsed)) {
			return true, model.ID
		}
	}
	return false, ""
}

// fingerprintClaimVerdict 判断最像的模型是否与我们请求的模型一致。
// 请求名可能带日期/提供商后缀，因此做宽松归一再比较；完全对不上时返回
// comparable=false，避免把"库外模型"误判成"被换模型"。
func fingerprintClaimVerdict(requestedModel, prediction string) (comparable bool, matches bool) {
	requested := normalizeFingerprintModelSpelling(requestedModel)
	predicted := normalizeFingerprintModelSpelling(prediction)
	if requested == "" || predicted == "" {
		return false, false
	}
	if requested == predicted {
		return true, true
	}
	collapse := func(value string) string {
		replacer := strings.NewReplacer("-", "", "_", "", ".", "", " ", "")
		return replacer.Replace(value)
	}
	requestedCollapsed, predictedCollapsed := collapse(requested), collapse(predicted)
	if requestedCollapsed == predictedCollapsed {
		return true, true
	}
	if strings.HasPrefix(requestedCollapsed, predictedCollapsed) || strings.HasPrefix(predictedCollapsed, requestedCollapsed) {
		return true, true
	}
	return true, false
}

// normalizeFingerprintModelSpelling 去掉提供商前缀并小写化后的模型名。
func normalizeFingerprintModelSpelling(model string) string {
	value := strings.ToLower(strings.TrimSpace(model))
	if index := strings.LastIndexByte(value, '/'); index >= 0 {
		value = strings.TrimSpace(value[index+1:])
	}
	return value
}

// RunModelFingerprintBatch 执行 账号 × 模型 的全矩阵检测。
// 组合之间用受限并发；每个组合内部串行跑多轮挑战（同一账号并发多轮容易被
// 上游限流，也会互相污染指纹）。
func (s *AccountTestService) RunModelFingerprintBatch(ctx context.Context, options ModelFingerprintOptions) *ModelFingerprintReport {
	report := &ModelFingerprintReport{StartedAt: time.Now().UTC()}
	rounds := options.Rounds
	if rounds <= 0 {
		rounds = ModelFingerprintDefaultRounds
	}
	if rounds > ModelFingerprintMaxRounds {
		rounds = ModelFingerprintMaxRounds
	}
	report.Rounds = rounds

	detector, err := loadFingerprintDetector(ctx)
	if err != nil {
		report.Errors = append(report.Errors, err.Error())
		report.FinishedAt = time.Now().UTC()
		return report
	}
	report.BankBuiltAt = detector.BuiltAt()

	accountIDs := uniquePositiveIDs(options.AccountIDs)
	modelIDs := uniqueFingerprintModels(options.ModelIDs)
	if len(accountIDs) == 0 || len(modelIDs) == 0 {
		report.Errors = append(report.Errors, "both account_ids and model_ids are required")
		report.FinishedAt = time.Now().UTC()
		return report
	}

	type target struct {
		accountID int64
		modelID   string
	}
	targets := make([]target, 0, len(accountIDs)*len(modelIDs))
	for _, accountID := range accountIDs {
		for _, modelID := range modelIDs {
			targets = append(targets, target{accountID: accountID, modelID: modelID})
		}
	}

	concurrency := options.Concurrency
	if concurrency <= 0 {
		concurrency = ModelFingerprintDefaultConcurrency
	}
	if concurrency > ModelFingerprintMaxConcurrency {
		concurrency = ModelFingerprintMaxConcurrency
	}
	if concurrency > len(targets) {
		concurrency = len(targets)
	}

	results := make([]ModelFingerprintResult, len(targets))
	var mu sync.Mutex
	completed, matched := 0, 0
	queue := make(chan int)

	var wg sync.WaitGroup
	for worker := 0; worker < concurrency; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range queue {
				item := targets[index]
				result, detectErr := s.DetectForAccount(ctx, item.accountID, item.modelID, rounds)
				if detectErr != nil {
					result = &ModelFingerprintResult{
						AccountID:       item.accountID,
						ModelID:         item.modelID,
						RequestedModel:  item.modelID,
						Decision:        ModelFingerprintDecisionError,
						Error:           detectErr.Error(),
						RequestedRounds: rounds,
						TestedAt:        time.Now().UTC(),
					}
				}
				results[index] = *result
				mu.Lock()
				completed++
				if result.MatchesClaim {
					matched++
				}
				snapshot := ModelFingerprintProgress{Total: len(targets), Completed: completed, Matched: matched}
				mu.Unlock()
				if options.OnProgress != nil {
					options.OnProgress(snapshot)
				}
			}
		}()
	}
	for index := range targets {
		select {
		case <-ctx.Done():
			queue <- index
		case queue <- index:
		}
	}
	close(queue)
	wg.Wait()

	report.Results = results
	report.FinishedAt = time.Now().UTC()
	return report
}

// uniquePositiveIDs 去重并丢弃非正数。
func uniquePositiveIDs(ids []int64) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// uniqueFingerprintModels 去重（忽略大小写）并排序。
func uniqueFingerprintModels(models []string) []string {
	seen := make(map[string]struct{}, len(models))
	out := make([]string, 0, len(models))
	for _, model := range models {
		trimmed := strings.TrimSpace(model)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, trimmed)
	}
	sort.Strings(out)
	return out
}

// runFingerprintProbe 用现有探针通道把 challenge prompt 发给账号并取回纯文本。
//
// 复用 TestAccountConnection 意味着凭据解析、OAuth 刷新、代理、TLS 指纹、
// 各平台协议与 SSE 解析全部沿用真实测试路径，不需要在这里重写一套上游调用。
// 代价是要构造一个 gin 上下文：探针本来就是把结果写进 gin 的 SSE 响应。
func (s *AccountTestService) runFingerprintProbe(ctx context.Context, accountID int64, modelID string, prompt string) (string, string) {
	recorder := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(recorder)
	ginCtx.Request = (&http.Request{}).WithContext(ctx)

	options := AccountTestOptions{Prompt: prompt, MaxTokens: modelFingerprintMaxOutputTokens}
	mode := AccountTestModeDefault
	if err := s.TestAccountConnection(ginCtx, accountID, modelID, prompt, mode, options); err != nil {
		text, errMsg := parseTestSSEOutput(recorder.Body.String())
		if strings.TrimSpace(text) != "" {
			// 部分路径在写出内容后才报错（例如流式读取中断），保留已得到的文本。
			return text, ""
		}
		if errMsg != "" {
			return "", errMsg
		}
		return "", err.Error()
	}
	return parseTestSSEOutput(recorder.Body.String())
}
