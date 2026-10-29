/**
 * 邮件通知配置卡片（对应 Vue 版 OpsEmailNotificationCard.vue；Vue 版当前未被页面引用，这里按原样移植）。
 * 卡片展示当前配置，编辑表单放在 BaseDialog 中。
 */
import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import Toggle from '@/components/common/Toggle'
import { opsAPI } from '@/api/admin/ops'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AlertSeverity, EmailNotificationConfig } from '../types'
import panel from './OpsPanel.module.css'
import form from './OpsSettingsForm.module.css'
import styles from './OpsEmailNotificationCard.module.css'

type Target = 'alert' | 'report'
type ReportConfig = EmailNotificationConfig['report']

/** 等价于 Vue 的 v-model.number：空串保持空串，其余按 parseFloat 解析。 */
function toNumberModel(raw: string): number {
  if (raw === '') return '' as unknown as number
  const n = Number.parseFloat(raw)
  return (Number.isNaN(n) ? raw : n) as number
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isNonNegativeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export default function OpsEmailNotificationCard() {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState<EmailNotificationConfig | null>(null)

  const [showEditor, setShowEditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<EmailNotificationConfig | null>(null)
  const [alertRecipientInput, setAlertRecipientInput] = useState('')
  const [reportRecipientInput, setReportRecipientInput] = useState('')
  const [alertRecipientError, setAlertRecipientError] = useState('')
  const [reportRecipientError, setReportRecipientError] = useState('')

  const severityOptions: Array<{ value: AlertSeverity | ''; label: string }> = [
    { value: '', label: t('admin.ops.email.minSeverityAll') },
    { value: 'critical', label: t('common.critical') },
    { value: 'warning', label: t('common.warning') },
    { value: 'info', label: t('common.info') }
  ]

  function validateCronField(enabled: boolean, cron: string): string | null {
    if (!enabled) return null
    if (!cron || !cron.trim()) return t('admin.ops.email.validation.cronRequired')
    if (cron.trim().split(/\s+/).length < 5) return t('admin.ops.email.validation.cronFormat')
    return null
  }

  const editorValidation = (() => {
    const errors: string[] = []
    if (!draft) return { valid: true, errors }

    if (draft.alert.enabled && draft.alert.recipients.length === 0) {
      errors.push(t('admin.ops.email.validation.alertRecipientsRequired'))
    }
    if (draft.report.enabled && draft.report.recipients.length === 0) {
      errors.push(t('admin.ops.email.validation.reportRecipientsRequired'))
    }

    const invalidAlertRecipients = draft.alert.recipients.filter((e) => !isValidEmailAddress(e))
    if (invalidAlertRecipients.length > 0) errors.push(t('admin.ops.email.validation.invalidRecipients'))

    const invalidReportRecipients = draft.report.recipients.filter((e) => !isValidEmailAddress(e))
    if (invalidReportRecipients.length > 0) errors.push(t('admin.ops.email.validation.invalidRecipients'))

    if (!isNonNegativeNumber(draft.alert.rate_limit_per_hour)) {
      errors.push(t('admin.ops.email.validation.rateLimitRange'))
    }
    if (!isNonNegativeNumber(draft.alert.batching_window_seconds) || draft.alert.batching_window_seconds > 86400) {
      errors.push(t('admin.ops.email.validation.batchWindowRange'))
    }

    const dailyErr = validateCronField(draft.report.daily_summary_enabled, draft.report.daily_summary_schedule)
    if (dailyErr) errors.push(dailyErr)
    const weeklyErr = validateCronField(draft.report.weekly_summary_enabled, draft.report.weekly_summary_schedule)
    if (weeklyErr) errors.push(weeklyErr)
    const digestErr = validateCronField(draft.report.error_digest_enabled, draft.report.error_digest_schedule)
    if (digestErr) errors.push(digestErr)
    const accErr = validateCronField(draft.report.account_health_enabled, draft.report.account_health_schedule)
    if (accErr) errors.push(accErr)

    if (!isNonNegativeNumber(draft.report.error_digest_min_count)) {
      errors.push(t('admin.ops.email.validation.digestMinCountRange'))
    }

    const thr = draft.report.account_health_error_rate_threshold
    if (!(typeof thr === 'number' && Number.isFinite(thr) && thr >= 0 && thr <= 100)) {
      errors.push(t('admin.ops.email.validation.accountHealthThresholdRange'))
    }

    return { valid: errors.length === 0, errors }
  })()

  async function loadConfig() {
    setLoading(true)
    try {
      const data = await opsAPI.getEmailNotificationConfig()
      setConfig(data)
    } catch (err: any) {
      console.error('[OpsEmailNotificationCard] Failed to load config', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.email.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  // 挂载时加载（Vue 版 onMounted）
  useMountOnce(() => loadConfig())

  async function saveConfig() {
    if (!draft) return
    if (!editorValidation.valid) {
      useAppStore.getState().showError(editorValidation.errors[0] || t('admin.ops.email.validation.invalid'))
      return
    }
    setSaving(true)
    try {
      setConfig(await opsAPI.updateEmailNotificationConfig(draft))
      setShowEditor(false)
      useAppStore.getState().showSuccess(t('admin.ops.email.saveSuccess'))
    } catch (err: any) {
      console.error('[OpsEmailNotificationCard] Failed to save config', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.email.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function openEditor() {
    if (!config) return
    setDraft(JSON.parse(JSON.stringify(config)))
    setAlertRecipientInput('')
    setReportRecipientInput('')
    setAlertRecipientError('')
    setReportRecipientError('')
    setShowEditor(true)
  }

  function updateAlert(patch: Partial<EmailNotificationConfig['alert']>) {
    setDraft((prev) => (prev ? { ...prev, alert: { ...prev.alert, ...patch } } : prev))
  }

  function updateReport(patch: Partial<ReportConfig>) {
    setDraft((prev) => (prev ? { ...prev, report: { ...prev.report, ...patch } } : prev))
  }

  function addRecipient(target: Target) {
    if (!draft) return
    const raw = (target === 'alert' ? alertRecipientInput : reportRecipientInput).trim()
    if (!raw) return

    if (!isValidEmailAddress(raw)) {
      const msg = t('common.invalidEmail')
      if (target === 'alert') setAlertRecipientError(msg)
      else setReportRecipientError(msg)
      return
    }

    const normalized = raw.toLowerCase()
    const list = draft[target].recipients
    if (!list.includes(normalized)) {
      if (target === 'alert') updateAlert({ recipients: [...list, normalized] })
      else updateReport({ recipients: [...list, normalized] })
    }
    if (target === 'alert') setAlertRecipientInput('')
    else setReportRecipientInput('')
    if (target === 'alert') setAlertRecipientError('')
    else setReportRecipientError('')
  }

  function removeRecipient(target: Target, email: string) {
    if (!draft) return
    const list = draft[target].recipients
    const idx = list.indexOf(email)
    if (idx < 0) return
    const next = list.filter((_, i) => i !== idx)
    if (target === 'alert') updateAlert({ recipients: next })
    else updateReport({ recipients: next })
  }

  const enabledLabel = (value: boolean) => (value ? t('common.enabled') : t('common.disabled'))

  const toggleField = (label: string, value: boolean, onChange: (next: boolean) => void) => (
    <div>
      <span className={form.label}>{label}</span>
      <div className={styles.toggle}>
        <Toggle value={value} onChange={onChange} aria-label={label} />
        <span>{enabledLabel(value)}</span>
      </div>
    </div>
  )

  const renderRecipients = (target: Target) => {
    if (!draft) return null
    const value = target === 'alert' ? alertRecipientInput : reportRecipientInput
    const setValue = target === 'alert' ? setAlertRecipientInput : setReportRecipientInput
    const error = target === 'alert' ? alertRecipientError : reportRecipientError
    return (
      <div className={`${form.group} ${form.span2}`}>
        <div className={form.inline}>
          <Input
            type="email"
            label={t('admin.ops.email.recipients')}
            value={value}
            onChange={setValue}
            placeholder={t('admin.ops.email.recipients')}
            error={error || undefined}
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
        {draft[target].recipients.length > 0 && (
          <div className={form.chips}>
            {draft[target].recipients.map((email) => (
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
        {target === 'alert' && <p className={form.hint}>{t('admin.ops.email.recipientsHint')}</p>}
      </div>
    )
  }

  const scheduleField = (
    label: string,
    enabledKey: 'daily_summary_enabled' | 'weekly_summary_enabled' | 'error_digest_enabled' | 'account_health_enabled',
    scheduleKey: 'daily_summary_schedule' | 'weekly_summary_schedule' | 'error_digest_schedule' | 'account_health_schedule'
  ) => {
    if (!draft) return null
    return (
      <div>
        <span className={form.label}>{label}</span>
        <div className={styles.schedule}>
          <Toggle value={draft.report[enabledKey]} onChange={(v) => updateReport({ [enabledKey]: v })} aria-label={label} />
          <Input
            value={draft.report[scheduleKey]}
            aria-label={label}
            placeholder={t('admin.ops.email.cronPlaceholder')}
            onChange={(raw) => updateReport({ [scheduleKey]: raw })}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      <section className={panel.panel}>
        <div className={panel.header}>
          <div>
            <h2 className={panel.title}>{t('admin.ops.email.title')}</h2>
            <p className={panel.subtitle}>{t('admin.ops.email.description')}</p>
          </div>
          <div className={panel.toolbar}>
            <Button size="sm" variant="secondary" disabled={loading} onClick={() => void loadConfig()}>
              <RefreshCw size={14} aria-hidden="true" className={loading ? styles.spin : undefined} />
              {t('common.refresh')}
            </Button>
            <Button size="sm" variant="secondary" disabled={!config} onClick={openEditor}>
              {t('common.edit')}
            </Button>
          </div>
        </div>

        {!config ? (
          <div className={panel.muted}>{loading ? t('admin.ops.email.loading') : t('admin.ops.email.noData')}</div>
        ) : (
          <div className={form.stack}>
            <div className={form.section}>
              <h3 className={form.subTitle}>{t('admin.ops.email.alertTitle')}</h3>
              <div className={form.summaryGrid}>
                <div>
                  {t('common.enabled')}:<span className={form.summaryValue}>{enabledLabel(config.alert.enabled)}</span>
                </div>
                <div>
                  {t('admin.ops.email.recipients')}:<span className={form.summaryValue}>{config.alert.recipients.length}</span>
                </div>
                <div>
                  {t('admin.ops.email.minSeverity')}:
                  <span className={form.summaryValue}>{config.alert.min_severity || t('admin.ops.email.minSeverityAll')}</span>
                </div>
                <div>
                  {t('admin.ops.email.rateLimitPerHour')}:
                  <span className={form.summaryValue}>{config.alert.rate_limit_per_hour}</span>
                </div>
              </div>
            </div>

            <div className={form.section}>
              <h3 className={form.subTitle}>{t('admin.ops.email.reportTitle')}</h3>
              <div className={form.summaryGrid}>
                <div>
                  {t('common.enabled')}:<span className={form.summaryValue}>{enabledLabel(config.report.enabled)}</span>
                </div>
                <div>
                  {t('admin.ops.email.recipients')}:<span className={form.summaryValue}>{config.report.recipients.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <BaseDialog
        show={showEditor}
        title={t('admin.ops.email.title')}
        width="extra-wide"
        onClose={() => setShowEditor(false)}
        footer={
          <div className={form.footer}>
            <Button type="button" variant="secondary" onClick={() => setShowEditor(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={saving || !editorValidation.valid}
              onClick={() => void saveConfig()}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        }
      >
        {draft && (
          <div className={form.stack}>
            {!editorValidation.valid && (
              <Alert tone="warning" title={t('admin.ops.email.validation.title')}>
                <ul className={form.errorList}>
                  {editorValidation.errors.map((msg, index) => (
                    <li key={`${msg}-${index}`}>{msg}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <section className={form.section}>
              <h3 className={form.sectionTitle}>{t('admin.ops.email.alertTitle')}</h3>
              <div className={form.grid2}>
                {toggleField(t('common.enabled'), draft.alert.enabled, (v) => updateAlert({ enabled: v }))}

                <div>
                  <span className={form.label}>{t('admin.ops.email.minSeverity')}</span>
                  <Select
                    value={draft.alert.min_severity}
                    options={severityOptions}
                    aria-label={t('admin.ops.email.minSeverity')}
                    onChange={(v) => updateAlert({ min_severity: v as AlertSeverity | '' })}
                  />
                </div>

                {renderRecipients('alert')}

                <Input
                  type="number"
                  label={t('admin.ops.email.rateLimitPerHour')}
                  value={draft.alert.rate_limit_per_hour}
                  min={0}
                  max={100000}
                  onChange={(raw) => updateAlert({ rate_limit_per_hour: toNumberModel(raw) })}
                />

                <Input
                  type="number"
                  label={t('admin.ops.email.batchWindowSeconds')}
                  value={draft.alert.batching_window_seconds}
                  min={0}
                  max={86400}
                  onChange={(raw) => updateAlert({ batching_window_seconds: toNumberModel(raw) })}
                />

                {toggleField(t('admin.ops.email.includeResolved'), draft.alert.include_resolved_alerts, (v) =>
                  updateAlert({ include_resolved_alerts: v })
                )}
              </div>
            </section>

            <section className={form.section}>
              <h3 className={form.sectionTitle}>{t('admin.ops.email.reportTitle')}</h3>
              <div className={form.grid2}>
                {toggleField(t('common.enabled'), draft.report.enabled, (v) => updateReport({ enabled: v }))}

                {renderRecipients('report')}

                <div className={`${form.span2} ${form.group}`}>
                  <div className={form.grid2}>
                    {scheduleField(t('admin.ops.email.dailySummary'), 'daily_summary_enabled', 'daily_summary_schedule')}
                    {scheduleField(t('admin.ops.email.weeklySummary'), 'weekly_summary_enabled', 'weekly_summary_schedule')}
                    {scheduleField(t('admin.ops.email.errorDigest'), 'error_digest_enabled', 'error_digest_schedule')}
                    <Input
                      type="number"
                      label={t('admin.ops.email.errorDigestMinCount')}
                      value={draft.report.error_digest_min_count}
                      min={0}
                      max={1000000}
                      onChange={(raw) => updateReport({ error_digest_min_count: toNumberModel(raw) })}
                    />
                    {scheduleField(t('admin.ops.email.accountHealth'), 'account_health_enabled', 'account_health_schedule')}
                    <Input
                      type="number"
                      label={t('admin.ops.email.accountHealthThreshold')}
                      value={draft.report.account_health_error_rate_threshold}
                      min={0}
                      max={100}
                      step={0.1}
                      onChange={(raw) => updateReport({ account_health_error_rate_threshold: toNumberModel(raw) })}
                    />
                  </div>
                  <p className={form.hint}>{t('admin.ops.email.reportHint')}</p>
                </div>
              </div>
            </section>
          </div>
        )}
      </BaseDialog>
    </>
  )
}
