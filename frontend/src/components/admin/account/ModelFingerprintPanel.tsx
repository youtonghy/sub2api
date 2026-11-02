/**
 * 模型指纹核验面板，对应 Vue 版 ModelFingerprintPanel.vue。
 * 选择账号与模型矩阵，按轮数与并发提交指纹任务（服务端异步任务，轮询进度），渲染核验报告。
 */
import { RefreshCw, Shield } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type {
  ModelFingerprintBankInfo,
  ModelFingerprintJob,
  ModelFingerprintReport,
  ModelFingerprintResult
} from '@/api/admin/accounts'
import { Alert } from '@/components/arc/alert/alert'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import type { Account, ClaudeModel } from '@/types'
import styles from './ModelFingerprintPanel.module.css'

export interface ModelFingerprintPanelProps {
  accounts: Account[]
  platform: string
  active: boolean
}

const concurrencyOptions = [1, 2, 3, 4].map((value) => ({ value, label: String(value) }))

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`
const formatTime = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const probabilityTone = (value: number) => {
  if (value >= 0.8) return 'success'
  if (value >= 0.5) return 'warning'
  return 'neutral'
}

const verdictTone = (result: ModelFingerprintResult): BadgeTone => {
  if (result.decision === 'error' || result.decision === 'not_model') return 'danger'
  if (result.decision === 'unscorable') return 'neutral'
  if (!result.claim_comparable) return 'info'
  if (result.matches_claim) return 'success'
  return 'warning'
}

const resultKey = (result: ModelFingerprintResult) => `${result.account_id}:${result.model_id}`

export default function ModelFingerprintPanel({ accounts, platform, active }: ModelFingerprintPanelProps) {
  const { t } = useI18n()

  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([])
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [modelSearch, setModelSearch] = useState('')
  const [rounds, setRounds] = useState(3)
  const [concurrency, setConcurrency] = useState(2)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<ModelFingerprintReport | null>(null)
  const [expandedKey, setExpandedKey] = useState('')
  const [progress, setProgress] = useState<ModelFingerprintJob['progress']>({ total: 0, completed: 0, matched: 0 })
  const [bank, setBank] = useState<ModelFingerprintBankInfo | null>(null)
  const [bankError, setBankError] = useState('')
  const [accountModels, setAccountModels] = useState<Record<number, string[]>>({})
  const [loadingModels, setLoadingModels] = useState(false)

  const runningRef = useRef(false)
  const propsRef = useRef({ accounts, active })
  useEffect(() => {
    propsRef.current = { accounts, active }
  })

  const roundOptions = useMemo(
    () => [
      { value: 3, label: t('admin.accounts.modelFingerprint.roundsCalibrated') },
      { value: 1, label: t('admin.accounts.modelFingerprint.roundsQuick') }
    ],
    [t]
  )

  // 参考库内的模型 ID（小写）用于标注哪些请求模型可"声称比对"。
  const bankModelIds = useMemo(() => new Set((bank?.models || []).map((model) => model.id.toLowerCase())), [bank])

  // 模型清单 = 选中账号可用模型的并集（按账号真实能力，而不是写死的清单）。
  const availableModels = useMemo(() => {
    const seen = new Map<string, ClaudeModel>()
    const ids = selectedAccountIds.length ? selectedAccountIds : accounts.map((account) => account.id)
    ids.forEach((id) => {
      ;(accountModels[id] || []).forEach((modelID) => {
        if (!modelID) return
        if (!seen.has(modelID)) seen.set(modelID, { id: modelID, display_name: modelID, type: 'model', created_at: '' })
      })
    })
    return Array.from(seen.values()).sort((left, right) => left.id.localeCompare(right.id))
  }, [accountModels, accounts, selectedAccountIds])

  const filteredModels = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase()
    if (!keyword) return availableModels
    return availableModels.filter((model) => model.id.toLowerCase().includes(keyword))
  }, [availableModels, modelSearch])

  const incomparableCount = selectedModelIds.filter((modelID) => !bankModelIds.has(modelID.toLowerCase())).length

  const combinations = selectedAccountIds.length * selectedModelIds.length
  const estimate = { combinations, total: combinations * rounds }

  const canRun = selectedAccountIds.length > 0 && selectedModelIds.length > 0

  const results = report?.results || []
  const matchedCount = results.filter((result) => result.matches_claim).length
  const mismatchCount = results.filter((result) => result.claim_comparable && !result.matches_claim).length
  const unscorableCount = results.filter(
    (result) => result.decision === 'unscorable' || result.decision === 'error' || result.decision === 'not_model'
  ).length

  const verdictLabel = (result: ModelFingerprintResult) => {
    if (result.decision === 'error') return t('admin.accounts.modelFingerprint.verdicts.error')
    if (result.decision === 'not_model') return t('admin.accounts.modelFingerprint.verdicts.notModel')
    if (result.decision === 'unscorable') return t('admin.accounts.modelFingerprint.verdicts.unscorable')
    if (!result.claim_comparable) return t('admin.accounts.modelFingerprint.verdicts.incomparable')
    if (result.matches_claim) return t('admin.accounts.modelFingerprint.verdicts.matches')
    return t('admin.accounts.modelFingerprint.verdicts.mismatch')
  }

  const toggleExpanded = (result: ModelFingerprintResult) => {
    const key = resultKey(result)
    setExpandedKey((current) => (current === key ? '' : key))
  }

  const selectAllAccounts = () => setSelectedAccountIds(accounts.map((account) => account.id))
  const selectAllModels = () => setSelectedModelIds(filteredModels.map((model) => model.id))

  const toggleAccount = (id: number, checked: boolean) =>
    setSelectedAccountIds((ids) => (checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((item) => item !== id)))
  const toggleModel = (id: string, checked: boolean) =>
    setSelectedModelIds((ids) => (checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((item) => item !== id)))

  // 挂载时加载参考库信息
  useMountOnce(async () => {
    setBankError('')
    try {
      setBank(await adminAPI.accounts.getModelFingerprintBank())
    } catch (loadError) {
      setBank(null)
      setBankError(loadError instanceof Error ? loadError.message : t('admin.accounts.modelFingerprint.bankFailed'))
    }
  })

  // 逐个账号取可用模型（服务端已有并发保护，这里限制在 6 个并发）。
  const loadModels = useCallback(async () => {
    const current = propsRef.current
    if (!current.active || current.accounts.length === 0) return
    setLoadingModels(true)
    const queue = [...current.accounts.map((account) => account.id)]
    const loaded: Record<number, string[]> = {}
    const worker = async () => {
      while (queue.length > 0) {
        const accountID = queue.shift()
        if (accountID == null) break
        try {
          const models = await adminAPI.accounts.getAvailableModels(accountID)
          loaded[accountID] = models.map((model) => model.id).filter(Boolean)
        } catch {
          loaded[accountID] = []
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
    setAccountModels(loaded)
    setLoadingModels(false)
    // 默认全选：批量检测的常见用法是"把所有账号的某个模型都跑一遍"。
    setSelectedAccountIds(current.accounts.map((account) => account.id))
    const union = new Set<string>()
    Object.values(loaded).forEach((ids) => ids.forEach((id) => union.add(id)))
    setSelectedModelIds(Array.from(union))
  }, [])

  const accountIdsKey = accounts.map((account) => account.id).join(',')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch 一致：账号或平台变化时清空报告并重新加载
    setReport(null)
    setError('')
    void loadModels()
  }, [active, platform, accountIdsKey, loadModels])

  const run = async () => {
    if (runningRef.current || !canRun) return
    runningRef.current = true
    setRunning(true)
    setError('')
    setReport(null)
    setExpandedKey('')
    setProgress({ total: estimate.combinations, completed: 0, matched: 0 })
    try {
      const next = await adminAPI.accounts.modelFingerprint(
        {
          account_ids: selectedAccountIds,
          model_ids: selectedModelIds,
          rounds,
          concurrency
        },
        {
          onProgress: (value) => setProgress(value)
        }
      )
      setReport(next)
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : t('admin.accounts.modelFingerprint.failed'))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }

  return (
    <div className={styles.root}>
      {/* Header: bank version + run controls */}
      <div className={styles.section}>
        <div className={styles.headerRow}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>{t('admin.accounts.modelFingerprint.title')}</h2>
            <p className={styles.description}>{t('admin.accounts.modelFingerprint.description')}</p>
            {bank ? (
              <p className={styles.meta}>
                {t('admin.accounts.modelFingerprint.bankInfo', { models: bank.models.length, builtAt: formatTime(bank.built_at) })}
              </p>
            ) : bankError ? (
              <p className={styles.metaError}>{bankError}</p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={running || !canRun}
            data-testid="model-fingerprint-run"
            onClick={() => void run()}
          >
            {running ? (
              <RefreshCw size={14} className={styles.spin} aria-hidden="true" />
            ) : (
              <Shield size={14} aria-hidden="true" />
            )}
            <span>
              {running
                ? t('admin.accounts.modelFingerprint.runningProgress', { done: progress.completed, total: progress.total })
                : t('admin.accounts.modelFingerprint.run')}
            </span>
          </Button>
        </div>

        {estimate.total > 0 ? (
          <div className={styles.estimate}>
            {t('admin.accounts.modelFingerprint.estimate', {
              combinations: estimate.combinations,
              rounds,
              requests: estimate.total,
              accounts: selectedAccountIds.length,
              models: selectedModelIds.length
            })}
          </div>
        ) : null}
      </div>

      <div className={`${styles.section} ${styles.pickers}`}>
        {/* Accounts */}
        <section>
          <div className={styles.pickerHeader}>
            <span className={styles.label}>{t('admin.accounts.modelFingerprint.accounts')}</span>
            <div className={styles.pickerActions}>
              <span className={styles.muted}>
                {t('admin.accounts.modelFingerprint.selectedCount', { count: selectedAccountIds.length, total: accounts.length })}
              </span>
              <button type="button" className={styles.link} disabled={running} onClick={selectAllAccounts}>
                {t('admin.accounts.modelFingerprint.selectAll')}
              </button>
              <button type="button" className={styles.linkMuted} disabled={running} onClick={() => setSelectedAccountIds([])}>
                {t('admin.accounts.modelFingerprint.clear')}
              </button>
            </div>
          </div>
          <div className={styles.list} data-size="lg">
            {accounts.map((account) => (
              <div key={account.id} className={styles.listRow} data-testid="model-fingerprint-account-row">
                <Checkbox
                  value={String(account.id)}
                  checked={selectedAccountIds.includes(account.id)}
                  disabled={running}
                  aria-label={account.name}
                  data-testid="model-fingerprint-account"
                  onCheckedChange={(checked) => toggleAccount(account.id, checked === true)}
                />
                <span className={styles.rowName}>{account.name}</span>
                <span className={styles.rowId}>#{account.id}</span>
              </div>
            ))}
            {accounts.length === 0 ? <div className={styles.listEmpty}>{t('admin.accounts.modelFingerprint.noAccounts')}</div> : null}
          </div>
        </section>

        {/* Models */}
        <section>
          <div className={styles.pickerHeader}>
            <span className={styles.label}>{t('admin.accounts.modelFingerprint.models')}</span>
            <div className={styles.pickerActions}>
              <span className={styles.muted}>
                {t('admin.accounts.modelFingerprint.selectedCount', { count: selectedModelIds.length, total: availableModels.length })}
              </span>
              <button type="button" className={styles.link} disabled={running} onClick={selectAllModels}>
                {t('admin.accounts.modelFingerprint.selectAll')}
              </button>
              <button type="button" className={styles.linkMuted} disabled={running} onClick={() => setSelectedModelIds([])}>
                {t('admin.accounts.modelFingerprint.clear')}
              </button>
            </div>
          </div>
          <div className={styles.search}>
            <Input
              value={modelSearch}
              onChange={setModelSearch}
              placeholder={t('admin.accounts.modelFingerprint.searchModels')}
              aria-label={t('admin.accounts.modelFingerprint.searchModels')}
            />
          </div>
          <div className={styles.list}>
            {filteredModels.map((model) => (
              <div key={model.id} className={styles.listRow} data-testid="model-fingerprint-model-row">
                <Checkbox
                  value={model.id}
                  checked={selectedModelIds.includes(model.id)}
                  disabled={running}
                  aria-label={model.id}
                  data-testid="model-fingerprint-model"
                  onCheckedChange={(checked) => toggleModel(model.id, checked === true)}
                />
                <span className={styles.rowName}>{model.id}</span>
                {bankModelIds.has(model.id.toLowerCase()) ? (
                  <Badge tone="success" size="sm" title={t('admin.accounts.modelFingerprint.comparableHint')}>
                    {t('admin.accounts.modelFingerprint.comparable')}
                  </Badge>
                ) : null}
              </div>
            ))}
            {loadingModels ? (
              <div className={styles.listEmpty}>{t('admin.accounts.modelFingerprint.loadingModels')}</div>
            ) : filteredModels.length === 0 ? (
              <div className={styles.listEmpty}>{t('admin.accounts.modelFingerprint.noModels')}</div>
            ) : null}
          </div>
          {incomparableCount > 0 ? (
            <p className={styles.warnHint}>
              {t('admin.accounts.modelFingerprint.incomparableHint', { count: incomparableCount })}
            </p>
          ) : null}
        </section>
      </div>

      {/* Options */}
      <div className={`${styles.section} ${styles.options}`}>
        <div className={styles.option}>
          <span className={styles.label}>{t('admin.accounts.modelFingerprint.rounds')}</span>
          <Select
            value={rounds}
            options={roundOptions}
            disabled={running}
            aria-label={t('admin.accounts.modelFingerprint.rounds')}
            onChange={(value) => setRounds(Number(value))}
          />
        </div>
        <div className={styles.option}>
          <span className={styles.label}>{t('admin.accounts.modelFingerprint.concurrency')}</span>
          <Select
            value={concurrency}
            options={concurrencyOptions}
            disabled={running}
            aria-label={t('admin.accounts.modelFingerprint.concurrency')}
            onChange={(value) => setConcurrency(Number(value))}
          />
        </div>
        <p className={styles.optionsHint}>{t('admin.accounts.modelFingerprint.roundsHint')}</p>
      </div>

      {error ? (
        <div className={styles.errorWrap}>
          <Alert tone="danger" title={error} />
        </div>
      ) : null}

      {/* Results */}
      {report ? (
        <div className={styles.report}>
          <div className={styles.reportHeader}>
            <div>
              <h3 className={styles.reportTitle}>{t('admin.accounts.modelFingerprint.report')}</h3>
              <p className={styles.muted}>
                {t('admin.accounts.modelFingerprint.reportSummary', {
                  total: results.length,
                  matched: matchedCount,
                  mismatch: mismatchCount,
                  unscorable: unscorableCount
                })}
              </p>
            </div>
            <span className={styles.muted}>{formatTime(report.finished_at || report.started_at)}</span>
          </div>

          {(report.errors || []).map((groupError) => (
            <div key={groupError} className={styles.groupError}>
              {groupError}
            </div>
          ))}

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('admin.accounts.modelFingerprint.columns.account')}</th>
                  <th>{t('admin.accounts.modelFingerprint.columns.requested')}</th>
                  <th>{t('admin.accounts.modelFingerprint.columns.verdict')}</th>
                  <th>{t('admin.accounts.modelFingerprint.columns.prediction')}</th>
                  <th>{t('admin.accounts.modelFingerprint.columns.confidence')}</th>
                  <th>{t('admin.accounts.modelFingerprint.columns.samples')}</th>
                  <th>{t('admin.accounts.modelFingerprint.columns.evidence')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => {
                  const key = resultKey(result)
                  const expanded = expandedKey === key
                  return (
                    <Fragment key={key}>
                      <tr data-testid="model-fingerprint-row">
                        <td>
                          <div className={styles.strong}>{result.account_name || `#${result.account_id}`}</div>
                          <div className={styles.monoMuted}>
                            #{result.account_id}
                            {result.platform ? ` · ${result.platform}` : null}
                          </div>
                        </td>
                        <td className={styles.mono}>
                          {result.requested_model || result.model_id}
                          {result.model_id && result.model_id !== result.requested_model ? (
                            <div className={styles.mutedInline}>→ {result.model_id}</div>
                          ) : null}
                        </td>
                        <td>
                          <Badge tone={verdictTone(result)} size="sm">
                            {verdictLabel(result)}
                          </Badge>
                        </td>
                        <td>
                          {result.prediction ? (
                            <>
                              <div className={styles.strong}>{result.prediction_name || result.prediction}</div>
                              <div className={styles.small}>{result.family_name || result.family_prediction}</div>
                            </>
                          ) : (
                            <span className={styles.mutedInline}>—</span>
                          )}
                        </td>
                        <td>
                          {typeof result.probability === 'number' ? (
                            <>
                              <div className={styles.probability} data-tone={probabilityTone(result.probability)}>
                                {formatPercent(result.probability)}
                              </div>
                              <div className={styles.small}>{t('admin.accounts.modelFingerprint.closedSet')}</div>
                            </>
                          ) : (
                            <span className={styles.mutedInline} title={t('admin.accounts.modelFingerprint.noConfidenceHint')}>
                              —
                            </span>
                          )}
                        </td>
                        <td>
                          <div className={styles.samplesCount} data-tone={result.used_outputs >= 3 ? 'success' : 'warning'}>
                            {result.used_outputs}/{result.requested_rounds}
                          </div>
                          <div className={styles.small}>{t('admin.accounts.modelFingerprint.validSamples')}</div>
                        </td>
                        <td>
                          <button type="button" className={styles.link} onClick={() => toggleExpanded(result)}>
                            {expanded
                              ? t('admin.accounts.modelFingerprint.hideDetail')
                              : t('admin.accounts.modelFingerprint.showDetail')}
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className={styles.detailRow}>
                          <td colSpan={7}>
                            {result.error ? <div className={styles.detailError}>{result.error}</div> : null}
                            {result.evidence ? <div className={styles.detailText}>{result.evidence}</div> : null}
                            {result.sequence ? (
                              <div className={styles.detailText}>
                                {t('admin.accounts.modelFingerprint.sequenceLine', {
                                  autocorrelation: result.sequence.autocorrelation.toFixed(3),
                                  smallStep: (result.sequence.small_step_share * 100).toFixed(1),
                                  modelLike: result.sequence.model_like
                                    ? t('admin.accounts.modelFingerprint.yes')
                                    : t('admin.accounts.modelFingerprint.no')
                                })}
                              </div>
                            ) : null}
                            <div className={styles.detailGrid}>
                              <div>
                                <div className={styles.detailHeading}>{t('admin.accounts.modelFingerprint.sampleDetail')}</div>
                                <div className={styles.stack}>
                                  {result.samples.map((sample) => (
                                    <div key={sample.index} className={styles.sample}>
                                      <div className={styles.sampleHead}>
                                        <span data-tone={sample.accepted ? 'success' : 'warning'} className={styles.toned}>
                                          #{sample.index + 1}{' '}
                                          {sample.accepted
                                            ? t('admin.accounts.modelFingerprint.sampleAccepted')
                                            : t('admin.accounts.modelFingerprint.sampleRejected')}
                                        </span>
                                        <span className={styles.mutedInline}>
                                          {sample.parsed_numbers}/{sample.expected_count} · {sample.latency_ms}ms
                                        </span>
                                      </div>
                                      {sample.error ? (
                                        <div className={styles.toned} data-tone="warning">
                                          {sample.error}
                                        </div>
                                      ) : null}
                                      {sample.preview ? <div className={styles.preview}>{sample.preview}</div> : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <div className={styles.detailHeading}>{t('admin.accounts.modelFingerprint.candidates')}</div>
                                <div className={styles.stackTight}>
                                  {(result.candidates || []).slice(0, 8).map((candidate) => (
                                    <div
                                      key={candidate.model}
                                      className={styles.candidate}
                                      data-current={
                                        candidate.model === result.requested_model || candidate.model === result.model_id
                                          ? 'true'
                                          : 'false'
                                      }
                                    >
                                      <span className={styles.candidateName}>{candidate.display_name || candidate.model}</span>
                                      <span className={styles.monoMuted}>
                                        {candidate.probability != null
                                          ? formatPercent(candidate.probability)
                                          : candidate.score.toFixed(2)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.disclaimer}>{t('admin.accounts.modelFingerprint.disclaimer')}</p>
        </div>
      ) : !running ? (
        <div className={styles.empty}>
          <Shield size={28} className={styles.emptyIcon} aria-hidden="true" />
          <p>{t('admin.accounts.modelFingerprint.emptyState')}</p>
        </div>
      ) : null}
    </div>
  )
}
