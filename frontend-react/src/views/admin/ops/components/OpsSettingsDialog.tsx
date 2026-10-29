/**
 * 运维监控设置（对应 Vue 版 OpsSettingsDialog.vue）。
 * 表单较长，React 版改用 Arc drawer 从右侧滑出，而不是居中对话框；关闭抽屉即触发 onClose。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import Toggle from '@/components/common/Toggle'
import { opsAPI } from '@/api/admin/ops'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type {
  AlertSeverity,
  EmailNotificationConfig,
  OpsAdvancedSettings,
  OpsAlertRuntimeSettings,
  OpsMetricThresholds
} from '../types'
import styles from './OpsSettingsDialog.module.css'
import form from './OpsSettingsForm.module.css'

export interface OpsSettingsDialogProps {
  show: boolean
  onClose?: () => void
  onSaved?: () => void
}

const DEFAULT_THRESHOLDS: OpsMetricThresholds = {
  sla_percent_min: 99.5,
  ttft_p99_ms_max: 500,
  request_error_rate_percent_max: 5,
  upstream_error_rate_percent_max: 5
}

/** 等价于 Vue 的 v-model.number：空串保持空串，其余按 parseFloat 解析。 */
function toNumberModel(raw: string): number {
  if (raw === '') return '' as unknown as number
  const n = Number.parseFloat(raw)
  return (Number.isNaN(n) ? raw : n) as number
}

// 验证邮箱
function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function OpsSettingsDialog({ show, onClose, onSaved }: OpsSettingsDialogProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // 运行时设置
  const [runtimeSettings, setRuntimeSettings] = useState<OpsAlertRuntimeSettings | null>(null)
  // 邮件通知配置
  const [emailConfig, setEmailConfig] = useState<EmailNotificationConfig | null>(null)
  // 高级设置
  const [advancedSettings, setAdvancedSettings] = useState<OpsAdvancedSettings | null>(null)
  // 指标阈值配置
  const [metricThresholds, setMetricThresholds] = useState<OpsMetricThresholds>(DEFAULT_THRESHOLDS)

  // 邮件输入
  const [alertRecipientInput, setAlertRecipientInput] = useState('')
  const [reportRecipientInput, setReportRecipientInput] = useState('')

  // 加载所有配置
  const loadAllSettings = useCallback(async () => {
    setSettingsLoaded(false)
    setLoading(true)
    try {
      const [runtime, email, advanced, thresholds] = await Promise.all([
        opsAPI.getAlertRuntimeSettings(),
        opsAPI.getEmailNotificationConfig(),
        opsAPI.getAdvancedSettings(),
        opsAPI.getMetricThresholds()
      ])
      setRuntimeSettings(runtime)
      setEmailConfig(email)
      // 兼容旧 payload：后端未返回该字段时补默认值，保证表单可绑定
      if (advanced && !advanced.openai_account_quota_auto_pause) {
        advanced.openai_account_quota_auto_pause = { default_threshold_5h: 0, default_threshold_7d: 0 }
      }
      setAdvancedSettings(advanced)
      // 如果后端返回了阈值，使用后端的值；否则保持默认值
      if (thresholds && Object.keys(thresholds).length > 0) {
        setMetricThresholds({
          sla_percent_min: thresholds.sla_percent_min ?? 99.5,
          ttft_p99_ms_max: thresholds.ttft_p99_ms_max ?? 500,
          request_error_rate_percent_max: thresholds.request_error_rate_percent_max ?? 5,
          upstream_error_rate_percent_max: thresholds.upstream_error_rate_percent_max ?? 5
        })
      }
      setSettingsLoaded(true)
    } catch (err: any) {
      console.error('[OpsSettingsDialog] Failed to load settings', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.settings.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // 监听弹窗打开
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时拉取设置，属于与后端同步的副作用
    if (show) void loadAllSettings()
    // 只在 show 变化时触发，与 Vue 版 watch(() => props.show) 一致
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  // 严重级别选项
  const severityOptions: Array<{ value: AlertSeverity | ''; label: string }> = [
    { value: '', label: t('admin.ops.email.minSeverityAll') },
    { value: 'critical', label: t('common.critical') },
    { value: 'warning', label: t('common.warning') },
    { value: 'info', label: t('common.info') }
  ]

  const updateEmail = (target: 'alert' | 'report', patch: Record<string, unknown>) => {
    setEmailConfig((prev) => (prev ? { ...prev, [target]: { ...prev[target], ...patch } } : prev))
  }

  // 添加收件人
  function addRecipient(target: 'alert' | 'report') {
    if (!emailConfig) return
    const raw = (target === 'alert' ? alertRecipientInput : reportRecipientInput).trim()
    if (!raw) return

    if (!isValidEmailAddress(raw)) {
      useAppStore.getState().showError(t('common.invalidEmail'))
      return
    }

    const normalized = raw.toLowerCase()
    const list = emailConfig[target].recipients
    if (!list.includes(normalized)) {
      updateEmail(target, { recipients: [...list, normalized] })
    }
    if (target === 'alert') setAlertRecipientInput('')
    else setReportRecipientInput('')
  }

  // 移除收件人
  function removeRecipient(target: 'alert' | 'report', email: string) {
    if (!emailConfig) return
    updateEmail(target, { recipients: emailConfig[target].recipients.filter((item) => item !== email) })
  }

  const updateAdvanced = (patch: Partial<OpsAdvancedSettings>) => {
    setAdvancedSettings((prev) => (prev ? { ...prev, ...patch } : prev))
  }
  const updateRetention = (patch: Partial<OpsAdvancedSettings['data_retention']>) => {
    setAdvancedSettings((prev) => (prev ? { ...prev, data_retention: { ...prev.data_retention, ...patch } } : prev))
  }

  // OpenAI 账号配额自动暂停：后端按 0~1 分数存储，UI 按百分比(0~100)展示
  const toPercent = (v: number | undefined): number | null => (v && v > 0 ? Math.round(v * 1000) / 10 : null)
  const setQuotaPercent = (key: 'default_threshold_5h' | 'default_threshold_7d', val: number | null) => {
    setAdvancedSettings((prev) => {
      if (!prev?.openai_account_quota_auto_pause) return prev
      return {
        ...prev,
        openai_account_quota_auto_pause: {
          ...prev.openai_account_quota_auto_pause,
          [key]: val != null && val > 0 ? val / 100 : 0
        }
      }
    })
  }
  const quotaAutoPause5hPercent = toPercent(advancedSettings?.openai_account_quota_auto_pause?.default_threshold_5h)
  const quotaAutoPause7dPercent = toPercent(advancedSettings?.openai_account_quota_auto_pause?.default_threshold_7d)

  // 验证
  const validation = useMemo(() => {
    const errors: string[] = []

    // 验证运行时设置
    if (runtimeSettings) {
      const evalSeconds = runtimeSettings.evaluation_interval_seconds
      if (!Number.isFinite(evalSeconds) || evalSeconds < 1 || evalSeconds > 86400) {
        errors.push(t('admin.ops.runtime.validation.evalIntervalRange'))
      }
    }

    // 邮件配置: 启用但无收件人时不阻断保存, 保存时会自动禁用

    // 验证高级设置
    if (advancedSettings) {
      const { error_log_retention_days, minute_metrics_retention_days, hourly_metrics_retention_days } = advancedSettings.data_retention
      if (error_log_retention_days < 0 || error_log_retention_days > 365) {
        errors.push(t('admin.ops.settings.validation.retentionDaysRange'))
      }
      if (minute_metrics_retention_days < 0 || minute_metrics_retention_days > 365) {
        errors.push(t('admin.ops.settings.validation.retentionDaysRange'))
      }
      if (hourly_metrics_retention_days < 0 || hourly_metrics_retention_days > 365) {
        errors.push(t('admin.ops.settings.validation.retentionDaysRange'))
      }

      const { default_threshold_5h, default_threshold_7d } = advancedSettings.openai_account_quota_auto_pause
      if (default_threshold_5h < 0 || default_threshold_5h > 1 || default_threshold_7d < 0 || default_threshold_7d > 1) {
        errors.push(t('admin.ops.settings.validation.openaiQuotaAutoPauseRange'))
      }
    }

    // 验证指标阈值
    const mt = metricThresholds
    if (mt.sla_percent_min != null && (mt.sla_percent_min < 0 || mt.sla_percent_min > 100)) {
      errors.push(t('admin.ops.settings.validation.slaMinPercentRange'))
    }
    if (mt.ttft_p99_ms_max != null && mt.ttft_p99_ms_max < 0) {
      errors.push(t('admin.ops.settings.validation.ttftP99MaxRange'))
    }
    if (mt.request_error_rate_percent_max != null && (mt.request_error_rate_percent_max < 0 || mt.request_error_rate_percent_max > 100)) {
      errors.push(t('admin.ops.settings.validation.requestErrorRateMaxRange'))
    }
    if (mt.upstream_error_rate_percent_max != null && (mt.upstream_error_rate_percent_max < 0 || mt.upstream_error_rate_percent_max > 100)) {
      errors.push(t('admin.ops.settings.validation.upstreamErrorRateMaxRange'))
    }

    return { valid: errors.length === 0, errors }
  }, [runtimeSettings, advancedSettings, metricThresholds, t])

  // 保存所有配置
  async function saveAllSettings() {
    if (loading || !settingsLoaded || saving) return
    if (!validation.valid) {
      useAppStore.getState().showError(validation.errors[0])
      return
    }

    setSaving(true)
    try {
      // 无收件人时自动禁用邮件通知
      let nextEmail = emailConfig
      if (nextEmail) {
        nextEmail = {
          alert: { ...nextEmail.alert },
          report: { ...nextEmail.report }
        }
        if (nextEmail.alert.enabled && nextEmail.alert.recipients.length === 0) {
          nextEmail.alert.enabled = false
        }
        if (nextEmail.report.enabled && nextEmail.report.recipients.length === 0) {
          nextEmail.report.enabled = false
        }
        setEmailConfig(nextEmail)
      }
      await Promise.all([
        runtimeSettings ? opsAPI.updateAlertRuntimeSettings(runtimeSettings) : Promise.resolve(),
        nextEmail ? opsAPI.updateEmailNotificationConfig(nextEmail) : Promise.resolve(),
        advancedSettings ? opsAPI.updateAdvancedSettings(advancedSettings) : Promise.resolve(),
        opsAPI.updateMetricThresholds(metricThresholds)
      ])
      useAppStore.getState().showSuccess(t('admin.ops.settings.saveSuccess'))
      onSaved?.()
      onClose?.()
    } catch (err: any) {
      console.error('[OpsSettingsDialog] Failed to save settings', err)
      useAppStore.getState().showError(err?.response?.data?.message || err?.response?.data?.detail || t('admin.ops.settings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const setThreshold = (key: keyof OpsMetricThresholds, raw: string) => {
    setMetricThresholds((prev) => ({ ...prev, [key]: toNumberModel(raw) }))
  }

  const renderRecipients = (target: 'alert' | 'report', label: string) => {
    if (!emailConfig) return null
    const value = target === 'alert' ? alertRecipientInput : reportRecipientInput
    const setValue = target === 'alert' ? setAlertRecipientInput : setReportRecipientInput
    return (
      <div className={form.group}>
        <div className={form.inline}>
          <Input
            type="email"
            label={label}
            value={value}
            onChange={setValue}
            placeholder={t('admin.ops.settings.emailPlaceholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addRecipient(target)
              }
            }}
          />
          <Button type="button" variant="secondary" className={styles.addButton} onClick={() => addRecipient(target)}>
            {t('common.add')}
          </Button>
        </div>
        {emailConfig[target].recipients.length > 0 && (
          <div className={form.chips}>
            {emailConfig[target].recipients.map((email) => (
              <span key={email} className={form.chip}>
                {email}
                <button
                  type="button"
                  className={form.chipRemove}
                  aria-label={`${t('common.delete')} ${email}`}
                  onClick={() => removeRecipient(target, email)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <p className={form.hint}>{t('admin.ops.settings.recipientsHint')}</p>
      </div>
    )
  }

  const switchRow = (label: string, value: boolean, onChange: (next: boolean) => void, hint?: string) => (
    <div className={form.switchRow}>
      <div className={form.switchText}>
        <span>{label}</span>
        {hint && <p className={form.hint}>{hint}</p>}
      </div>
      <Toggle value={value} onChange={onChange} aria-label={label} />
    </div>
  )

  const saveDisabled = loading || !settingsLoaded || saving || !validation.valid

  return (
    <Drawer
      open={show}
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      <DrawerContent title={t('admin.ops.settings.title')} className={styles.drawer}>
        {loading ? (
          <Skeleton label={t('common.loading')} lines={6} />
        ) : runtimeSettings && emailConfig && advancedSettings ? (
          <div className={form.stack}>
            {/* 验证错误 */}
            {!validation.valid && (
              <Alert tone="warning" title={t('admin.ops.settings.validation.title')}>
                <ul className={form.errorList}>
                  {validation.errors.map((msg, index) => (
                    <li key={`${msg}-${index}`}>{msg}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {/* 数据采集频率 */}
            <section className={form.section}>
              <h2 className={form.sectionTitle}>{t('admin.ops.settings.dataCollection')}</h2>
              <Input
                type="number"
                label={t('admin.ops.settings.evaluationInterval')}
                value={runtimeSettings.evaluation_interval_seconds}
                min={1}
                max={86400}
                hint={t('admin.ops.settings.evaluationIntervalHint')}
                onChange={(raw) =>
                  setRuntimeSettings((prev) => (prev ? { ...prev, evaluation_interval_seconds: toNumberModel(raw) } : prev))
                }
              />
            </section>

            {/* 预警配置 */}
            <section className={form.section}>
              <h2 className={form.sectionTitle}>{t('admin.ops.settings.alertConfig')}</h2>
              {switchRow(t('admin.ops.settings.enableAlert'), emailConfig.alert.enabled, (v) => updateEmail('alert', { enabled: v }))}
              {emailConfig.alert.enabled && renderRecipients('alert', t('admin.ops.settings.alertRecipients'))}
              {emailConfig.alert.enabled && (
                <div>
                  <span className={form.label}>{t('admin.ops.settings.minSeverity')}</span>
                  <Select
                    value={emailConfig.alert.min_severity}
                    options={severityOptions}
                    aria-label={t('admin.ops.settings.minSeverity')}
                    onChange={(v) => updateEmail('alert', { min_severity: v })}
                  />
                </div>
              )}
            </section>

            {/* 评估报告配置 */}
            <section className={form.section}>
              <h2 className={form.sectionTitle}>{t('admin.ops.settings.reportConfig')}</h2>
              {switchRow(t('admin.ops.settings.enableReport'), emailConfig.report.enabled, (v) => updateEmail('report', { enabled: v }))}
              {emailConfig.report.enabled && renderRecipients('report', t('admin.ops.settings.reportRecipients'))}
              {emailConfig.report.enabled && (
                <div className={form.grid2}>
                  {switchRow(t('admin.ops.settings.dailySummary'), emailConfig.report.daily_summary_enabled, (v) =>
                    updateEmail('report', { daily_summary_enabled: v })
                  )}
                  {emailConfig.report.daily_summary_enabled ? (
                    <Input
                      aria-label={t('admin.ops.settings.dailySummary')}
                      value={emailConfig.report.daily_summary_schedule}
                      placeholder="0 9 * * *"
                      onChange={(v) => updateEmail('report', { daily_summary_schedule: v })}
                    />
                  ) : (
                    <span />
                  )}
                  {switchRow(t('admin.ops.settings.weeklySummary'), emailConfig.report.weekly_summary_enabled, (v) =>
                    updateEmail('report', { weekly_summary_enabled: v })
                  )}
                  {emailConfig.report.weekly_summary_enabled && (
                    <Input
                      aria-label={t('admin.ops.settings.weeklySummary')}
                      value={emailConfig.report.weekly_summary_schedule}
                      placeholder="0 9 * * 1"
                      onChange={(v) => updateEmail('report', { weekly_summary_schedule: v })}
                    />
                  )}
                </div>
              )}
            </section>

            {/* 指标阈值配置 */}
            <section className={form.section}>
              <h2 className={form.sectionTitle}>{t('admin.ops.settings.metricThresholds')}</h2>
              <p className={form.hint}>{t('admin.ops.settings.metricThresholdsHint')}</p>
              <Input
                type="number"
                label={t('admin.ops.settings.slaMinPercent')}
                value={metricThresholds.sla_percent_min}
                min={0}
                max={100}
                step={0.1}
                hint={t('admin.ops.settings.slaMinPercentHint')}
                onChange={(raw) => setThreshold('sla_percent_min', raw)}
              />
              <Input
                type="number"
                label={t('admin.ops.settings.ttftP99MaxMs')}
                value={metricThresholds.ttft_p99_ms_max}
                min={0}
                step={50}
                hint={t('admin.ops.settings.ttftP99MaxMsHint')}
                onChange={(raw) => setThreshold('ttft_p99_ms_max', raw)}
              />
              <Input
                type="number"
                label={t('admin.ops.settings.requestErrorRateMaxPercent')}
                value={metricThresholds.request_error_rate_percent_max}
                min={0}
                max={100}
                step={0.1}
                hint={t('admin.ops.settings.requestErrorRateMaxPercentHint')}
                onChange={(raw) => setThreshold('request_error_rate_percent_max', raw)}
              />
              <Input
                type="number"
                label={t('admin.ops.settings.upstreamErrorRateMaxPercent')}
                value={metricThresholds.upstream_error_rate_percent_max}
                min={0}
                max={100}
                step={0.1}
                hint={t('admin.ops.settings.upstreamErrorRateMaxPercentHint')}
                onChange={(raw) => setThreshold('upstream_error_rate_percent_max', raw)}
              />
            </section>

            {/* 高级设置 */}
            <details className={form.details}>
              <summary>{t('admin.ops.settings.advancedSettings')}</summary>
              <div className={form.detailsBody}>
                {/* 数据保留策略 */}
                <div className={form.group}>
                  <h3 className={form.subTitle}>{t('admin.ops.settings.dataRetention')}</h3>
                  {switchRow(t('admin.ops.settings.enableCleanup'), advancedSettings.data_retention.cleanup_enabled, (v) =>
                    updateRetention({ cleanup_enabled: v })
                  )}
                  {advancedSettings.data_retention.cleanup_enabled && (
                    <Input
                      label={t('admin.ops.settings.cleanupSchedule')}
                      value={advancedSettings.data_retention.cleanup_schedule}
                      placeholder="0 2 * * *"
                      hint={t('admin.ops.settings.cleanupScheduleHint')}
                      onChange={(v) => updateRetention({ cleanup_schedule: v })}
                    />
                  )}
                  <div className={form.grid3}>
                    <Input
                      type="number"
                      label={t('admin.ops.settings.errorLogRetentionDays')}
                      value={advancedSettings.data_retention.error_log_retention_days}
                      min={0}
                      max={365}
                      onChange={(raw) => updateRetention({ error_log_retention_days: toNumberModel(raw) })}
                    />
                    <Input
                      type="number"
                      label={t('admin.ops.settings.minuteMetricsRetentionDays')}
                      value={advancedSettings.data_retention.minute_metrics_retention_days}
                      min={0}
                      max={365}
                      onChange={(raw) => updateRetention({ minute_metrics_retention_days: toNumberModel(raw) })}
                    />
                    <Input
                      type="number"
                      label={t('admin.ops.settings.hourlyMetricsRetentionDays')}
                      value={advancedSettings.data_retention.hourly_metrics_retention_days}
                      min={0}
                      max={365}
                      onChange={(raw) => updateRetention({ hourly_metrics_retention_days: toNumberModel(raw) })}
                    />
                  </div>
                  <p className={form.hint}>{t('admin.ops.settings.retentionDaysHint')}</p>
                </div>

                {/* 预聚合任务 */}
                <div className={form.group}>
                  <h3 className={form.subTitle}>{t('admin.ops.settings.aggregation')}</h3>
                  {switchRow(
                    t('admin.ops.settings.enableAggregation'),
                    advancedSettings.aggregation.aggregation_enabled,
                    (v) => updateAdvanced({ aggregation: { ...advancedSettings.aggregation, aggregation_enabled: v } }),
                    t('admin.ops.settings.aggregationHint')
                  )}
                </div>

                {/* OpenAI 账号配额自动暂停（全局默认阈值） */}
                <div className={form.group}>
                  <h3 className={form.subTitle}>{t('admin.ops.settings.openaiQuotaAutoPause')}</h3>
                  <p className={form.hint}>{t('admin.ops.settings.openaiQuotaAutoPauseHint')}</p>
                  <div className={form.grid2}>
                    <Input
                      type="number"
                      label={t('admin.ops.settings.openaiQuotaAutoPauseDefault5h')}
                      value={quotaAutoPause5hPercent}
                      min={0}
                      max={100}
                      step={0.1}
                      data-testid="ops-quota-auto-pause-5h"
                      onChange={(raw) => setQuotaPercent('default_threshold_5h', toNumberModel(raw))}
                    />
                    <Input
                      type="number"
                      label={t('admin.ops.settings.openaiQuotaAutoPauseDefault7d')}
                      value={quotaAutoPause7dPercent}
                      min={0}
                      max={100}
                      step={0.1}
                      data-testid="ops-quota-auto-pause-7d"
                      onChange={(raw) => setQuotaPercent('default_threshold_7d', toNumberModel(raw))}
                    />
                  </div>
                  <p className={form.hint}>{t('admin.ops.settings.openaiQuotaAutoPauseThresholdHint')}</p>
                </div>

                {/* Error Filtering */}
                <div className={form.group}>
                  <h3 className={form.subTitle}>{t('admin.ops.settings.errorFiltering')}</h3>
                  {switchRow(
                    t('admin.ops.settings.ignoreCountTokensErrors'),
                    advancedSettings.ignore_count_tokens_errors,
                    (v) => updateAdvanced({ ignore_count_tokens_errors: v }),
                    t('admin.ops.settings.ignoreCountTokensErrorsHint')
                  )}
                  {switchRow(
                    t('admin.ops.settings.ignoreContextCanceled'),
                    advancedSettings.ignore_context_canceled,
                    (v) => updateAdvanced({ ignore_context_canceled: v }),
                    t('admin.ops.settings.ignoreContextCanceledHint')
                  )}
                  {switchRow(
                    t('admin.ops.settings.ignoreNoAvailableAccounts'),
                    advancedSettings.ignore_no_available_accounts,
                    (v) => updateAdvanced({ ignore_no_available_accounts: v }),
                    t('admin.ops.settings.ignoreNoAvailableAccountsHint')
                  )}
                  {switchRow(
                    t('admin.ops.settings.ignoreInsufficientBalanceErrors'),
                    advancedSettings.ignore_insufficient_balance_errors,
                    (v) => updateAdvanced({ ignore_insufficient_balance_errors: v }),
                    t('admin.ops.settings.ignoreInsufficientBalanceErrorsHint')
                  )}
                </div>

                {/* Auto Refresh */}
                <div className={form.group}>
                  <h3 className={form.subTitle}>{t('admin.ops.settings.autoRefresh')}</h3>
                  {switchRow(
                    t('admin.ops.settings.enableAutoRefresh'),
                    advancedSettings.auto_refresh_enabled,
                    (v) => updateAdvanced({ auto_refresh_enabled: v }),
                    t('admin.ops.settings.enableAutoRefreshHint')
                  )}
                  {advancedSettings.auto_refresh_enabled && (
                    <div>
                      <span className={form.label}>{t('admin.ops.settings.refreshInterval')}</span>
                      <Select
                        value={advancedSettings.auto_refresh_interval_seconds}
                        aria-label={t('admin.ops.settings.refreshInterval')}
                        options={[
                          { value: 15, label: t('admin.ops.settings.refreshInterval15s') },
                          { value: 30, label: t('admin.ops.settings.refreshInterval30s') },
                          { value: 60, label: t('admin.ops.settings.refreshInterval60s') }
                        ]}
                        onChange={(v) => updateAdvanced({ auto_refresh_interval_seconds: v as number })}
                      />
                    </div>
                  )}
                </div>

                {/* Dashboard Cards */}
                <div className={form.group}>
                  <h3 className={form.subTitle}>{t('admin.ops.settings.dashboardCards')}</h3>
                  {switchRow(
                    t('admin.ops.settings.displayAlertEvents'),
                    advancedSettings.display_alert_events,
                    (v) => updateAdvanced({ display_alert_events: v }),
                    t('admin.ops.settings.displayAlertEventsHint')
                  )}
                  {switchRow(
                    t('admin.ops.settings.displayOpenAITokenStats'),
                    advancedSettings.display_openai_token_stats,
                    (v) => updateAdvanced({ display_openai_token_stats: v }),
                    t('admin.ops.settings.displayOpenAITokenStatsHint')
                  )}
                </div>
              </div>
            </details>
          </div>
        ) : null}

        <div className={styles.footer}>
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="primary" disabled={saveDisabled} onClick={() => void saveAllSettings()}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
