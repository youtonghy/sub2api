/**
 * 告警运行时设置卡片（对应 Vue 版 OpsRuntimeSettingsCard.vue；Vue 版当前未被页面引用，这里按原样移植）。
 * 卡片展示当前设置，编辑表单放在 BaseDialog 中。
 */
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import Toggle from '@/components/common/Toggle'
import { opsAPI } from '@/api/admin/ops'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { OpsAlertRuntimeSettings } from '../types'
import panel from './OpsPanel.module.css'
import form from './OpsSettingsForm.module.css'
import styles from './OpsRuntimeSettingsCard.module.css'

type ValidationResult = { valid: boolean; errors: string[] }
type SilenceEntry = NonNullable<OpsAlertRuntimeSettings['silencing']['entries']>[number]
type Translate = ReturnType<typeof useI18n>['t']

/** 等价于 Vue 的 v-model.number：空串保持空串，其余按 parseFloat 解析。 */
function toNumberModel(raw: string): number {
  if (raw === '') return '' as unknown as number
  const n = Number.parseFloat(raw)
  return (Number.isNaN(n) ? raw : n) as number
}

function normalizeSeverities(input: Array<string | null | undefined> | null | undefined): string[] {
  if (!input || input.length === 0) return []
  const allowed = new Set(['P0', 'P1', 'P2', 'P3'])
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    const s = String(raw || '')
      .trim()
      .toUpperCase()
    if (!s) continue
    if (!allowed.has(s)) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function validateRuntimeSettings(settings: OpsAlertRuntimeSettings, t: Translate): ValidationResult {
  const errors: string[] = []

  const evalSeconds = settings.evaluation_interval_seconds
  if (!Number.isFinite(evalSeconds) || evalSeconds < 1 || evalSeconds > 86400) {
    errors.push(t('admin.ops.runtime.validation.evalIntervalRange'))
  }

  // Thresholds validation
  const thresholds = settings.thresholds
  if (thresholds) {
    if (thresholds.sla_percent_min != null) {
      if (!Number.isFinite(thresholds.sla_percent_min) || thresholds.sla_percent_min < 0 || thresholds.sla_percent_min > 100) {
        errors.push(t('admin.ops.runtime.validation.slaMinPercentRange'))
      }
    }
    if (thresholds.ttft_p99_ms_max != null) {
      if (!Number.isFinite(thresholds.ttft_p99_ms_max) || thresholds.ttft_p99_ms_max < 0) {
        errors.push(t('admin.ops.runtime.validation.ttftP99MaxRange'))
      }
    }
    if (thresholds.request_error_rate_percent_max != null) {
      if (
        !Number.isFinite(thresholds.request_error_rate_percent_max) ||
        thresholds.request_error_rate_percent_max < 0 ||
        thresholds.request_error_rate_percent_max > 100
      ) {
        errors.push(t('admin.ops.runtime.validation.requestErrorRateMaxRange'))
      }
    }
    if (thresholds.upstream_error_rate_percent_max != null) {
      if (
        !Number.isFinite(thresholds.upstream_error_rate_percent_max) ||
        thresholds.upstream_error_rate_percent_max < 0 ||
        thresholds.upstream_error_rate_percent_max > 100
      ) {
        errors.push(t('admin.ops.runtime.validation.upstreamErrorRateMaxRange'))
      }
    }
  }

  const lock = settings.distributed_lock
  if (lock?.enabled) {
    if (!lock.key || lock.key.trim().length < 3) {
      errors.push(t('admin.ops.runtime.validation.lockKeyRequired'))
    } else if (!lock.key.startsWith('ops:')) {
      errors.push(t('admin.ops.runtime.validation.lockKeyPrefix', { prefix: 'ops:' }))
    }
    if (!Number.isFinite(lock.ttl_seconds) || lock.ttl_seconds < 1 || lock.ttl_seconds > 86400) {
      errors.push(t('admin.ops.runtime.validation.lockTtlRange'))
    }
  }

  // Silencing validation (alert-only)
  const silencing = settings.silencing
  if (silencing?.enabled) {
    const until = (silencing.global_until_rfc3339 || '').trim()
    if (until) {
      const parsed = Date.parse(until)
      if (!Number.isFinite(parsed)) errors.push(t('admin.ops.runtime.silencing.validation.timeFormat'))
    }

    const entries = Array.isArray(silencing.entries) ? silencing.entries : []
    for (let idx = 0; idx < entries.length; idx++) {
      const entry = entries[idx]
      const untilEntry = (entry?.until_rfc3339 || '').trim()
      if (!untilEntry) {
        errors.push(t('admin.ops.runtime.silencing.entries.validation.untilRequired'))
        break
      }
      const parsedEntry = Date.parse(untilEntry)
      if (!Number.isFinite(parsedEntry)) {
        errors.push(t('admin.ops.runtime.silencing.entries.validation.untilFormat'))
        break
      }
      const ruleId = (entry as any)?.rule_id
      if (typeof ruleId === 'number' && (!Number.isFinite(ruleId) || ruleId <= 0)) {
        errors.push(t('admin.ops.runtime.silencing.entries.validation.ruleIdPositive'))
        break
      }
      if ((entry as any)?.severities) {
        const raw = (entry as any).severities
        const normalized = normalizeSeverities(Array.isArray(raw) ? raw : [raw])
        if (Array.isArray(raw) && raw.length > 0 && normalized.length === 0) {
          errors.push(t('admin.ops.runtime.silencing.entries.validation.severitiesFormat'))
          break
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

export default function OpsRuntimeSettingsCard() {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [alertSettings, setAlertSettings] = useState<OpsAlertRuntimeSettings | null>(null)

  const [showAlertEditor, setShowAlertEditor] = useState(false)
  const [draftAlert, setDraftAlert] = useState<OpsAlertRuntimeSettings | null>(null)

  const alertValidation: ValidationResult = draftAlert
    ? validateRuntimeSettings(draftAlert, t)
    : { valid: true, errors: [] }

  async function loadSettings() {
    setLoading(true)
    try {
      setAlertSettings(await opsAPI.getAlertRuntimeSettings())
    } catch (err: any) {
      console.error('[OpsRuntimeSettingsCard] Failed to load runtime settings', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.runtime.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  // 挂载时加载（Vue 版 onMounted）
  useMountOnce(() => loadSettings())

  function openAlertEditor() {
    if (!alertSettings) return
    const draft: OpsAlertRuntimeSettings = JSON.parse(JSON.stringify(alertSettings))

    // Backwards-compat: ensure nested settings exist even if API payload is older.
    if (!draft.distributed_lock) {
      draft.distributed_lock = { enabled: true, key: 'ops:alert:evaluator:leader', ttl_seconds: 30 }
    }
    if (!draft.silencing) {
      draft.silencing = { enabled: false, global_until_rfc3339: '', global_reason: '', entries: [] }
    }
    if (!Array.isArray(draft.silencing.entries)) {
      draft.silencing.entries = []
    }
    if (!draft.thresholds) {
      draft.thresholds = {
        sla_percent_min: 99.5,
        ttft_p99_ms_max: 500,
        request_error_rate_percent_max: 5,
        upstream_error_rate_percent_max: 5
      }
    }

    setDraftAlert(draft)
    setShowAlertEditor(true)
  }

  // 草稿是不可变更新：每次修改都复制一份
  function updateDraft(mutate: (draft: OpsAlertRuntimeSettings) => void) {
    setDraftAlert((prev) => {
      if (!prev) return prev
      const next: OpsAlertRuntimeSettings = JSON.parse(JSON.stringify(prev))
      mutate(next)
      return next
    })
  }

  function updateEntry(index: number, mutate: (entry: SilenceEntry) => void) {
    updateDraft((draft) => {
      const entries = draft.silencing?.entries
      if (!entries || !entries[index]) return
      mutate(entries[index])
    })
  }

  function addSilenceEntry() {
    updateDraft((draft) => {
      if (!draft.silencing) {
        draft.silencing = { enabled: true, global_until_rfc3339: '', global_reason: '', entries: [] }
      }
      if (!Array.isArray(draft.silencing.entries)) {
        draft.silencing.entries = []
      }
      draft.silencing.entries.push({
        rule_id: undefined,
        severities: [],
        until_rfc3339: '',
        reason: ''
      })
    })
  }

  function removeSilenceEntry(index: number) {
    updateDraft((draft) => {
      if (!draft.silencing?.entries) return
      draft.silencing.entries.splice(index, 1)
    })
  }

  function updateSilenceEntryRuleId(index: number, raw: string) {
    updateEntry(index, (entry) => {
      const trimmed = raw.trim()
      if (!trimmed) {
        delete (entry as any).rule_id
        return
      }
      const n = Number.parseInt(trimmed, 10)
      ;(entry as any).rule_id = Number.isFinite(n) ? n : undefined
    })
  }

  function updateSilenceEntrySeverities(index: number, raw: string) {
    updateEntry(index, (entry) => {
      const parts = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      ;(entry as any).severities = normalizeSeverities(parts)
    })
  }

  async function saveAlertSettings() {
    if (!draftAlert) return
    if (!alertValidation.valid) {
      useAppStore.getState().showError(alertValidation.errors[0] || t('admin.ops.runtime.validation.invalid'))
      return
    }

    setSaving(true)
    try {
      setAlertSettings(await opsAPI.updateAlertRuntimeSettings(draftAlert))
      setShowAlertEditor(false)
      useAppStore.getState().showSuccess(t('admin.ops.runtime.saveSuccess'))
    } catch (err: any) {
      console.error('[OpsRuntimeSettingsCard] Failed to save alert runtime settings', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.runtime.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const switchRow = (label: string, value: boolean, onChange: (next: boolean) => void) => (
    <div className={form.switchRow}>
      <div className={form.switchText}>
        <span>{label}</span>
      </div>
      <Toggle value={value} onChange={onChange} aria-label={label} />
    </div>
  )

  const thresholdInput = (
    key: 'sla_percent_min' | 'ttft_p99_ms_max' | 'request_error_rate_percent_max' | 'upstream_error_rate_percent_max',
    label: string,
    hint: string,
    attrs: { min: number; max?: number; step: number; placeholder: string }
  ) => (
    <Input
      type="number"
      label={label}
      hint={hint}
      value={draftAlert?.thresholds?.[key] ?? ''}
      min={attrs.min}
      max={attrs.max}
      step={attrs.step}
      placeholder={attrs.placeholder}
      onChange={(raw) =>
        updateDraft((draft) => {
          draft.thresholds = { ...(draft.thresholds ?? {}), [key]: toNumberModel(raw) }
        })
      }
    />
  )

  const silencing = draftAlert?.silencing
  const entries = silencing?.entries ?? []

  return (
    <>
      <section className={panel.panel}>
        <div className={panel.header}>
          <div>
            <h2 className={panel.title}>{t('admin.ops.runtime.title')}</h2>
            <p className={panel.subtitle}>{t('admin.ops.runtime.description')}</p>
          </div>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => void loadSettings()}>
            <RefreshCw size={14} aria-hidden="true" className={loading ? styles.spin : undefined} />
            {t('common.refresh')}
          </Button>
        </div>

        {!alertSettings ? (
          <div className={panel.muted}>{loading ? t('admin.ops.runtime.loading') : t('admin.ops.runtime.noData')}</div>
        ) : (
          <div className={form.section}>
            <div className={panel.header}>
              <h3 className={form.subTitle}>{t('admin.ops.runtime.alertTitle')}</h3>
              <Button size="sm" variant="secondary" onClick={openAlertEditor}>
                {t('common.edit')}
              </Button>
            </div>
            <div className={form.summaryGrid}>
              <div>
                {t('admin.ops.runtime.evalIntervalSeconds')}:
                <span className={form.summaryValue}>{alertSettings.evaluation_interval_seconds}s</span>
              </div>
              {alertSettings.silencing?.enabled && alertSettings.silencing.global_until_rfc3339 && (
                <div className={form.span2}>
                  {t('admin.ops.runtime.silencing.globalUntil')}:
                  <span className={`${form.summaryValue} ${form.mono}`}>{alertSettings.silencing.global_until_rfc3339}</span>
                </div>
              )}

              <details className={`${form.span2} ${styles.developer}`}>
                <summary>{t('admin.ops.runtime.showAdvancedDeveloperSettings')}</summary>
                <div className={`${form.summaryGrid} ${styles.developerBody}`}>
                  <div>
                    {t('admin.ops.runtime.lockEnabled')}:
                    <span className={`${form.summaryValue} ${form.mono}`}>{String(alertSettings.distributed_lock.enabled)}</span>
                  </div>
                  <div>
                    {t('admin.ops.runtime.lockKey')}:
                    <span className={`${form.summaryValue} ${form.mono}`}>{alertSettings.distributed_lock.key}</span>
                  </div>
                  <div>
                    {t('admin.ops.runtime.lockTTLSeconds')}:
                    <span className={`${form.summaryValue} ${form.mono}`}>{alertSettings.distributed_lock.ttl_seconds}s</span>
                  </div>
                </div>
              </details>
            </div>
          </div>
        )}
      </section>

      <BaseDialog
        show={showAlertEditor}
        title={t('admin.ops.runtime.alertTitle')}
        width="extra-wide"
        onClose={() => setShowAlertEditor(false)}
        footer={
          <div className={form.footer}>
            <Button type="button" variant="secondary" onClick={() => setShowAlertEditor(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={saving || !alertValidation.valid}
              onClick={() => void saveAlertSettings()}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        }
      >
        {draftAlert && (
          <div className={form.stack}>
            {!alertValidation.valid && (
              <Alert tone="warning" title={t('admin.ops.runtime.validation.title')}>
                <ul className={form.errorList}>
                  {alertValidation.errors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <Input
              type="number"
              label={t('admin.ops.runtime.evalIntervalSeconds')}
              hint={t('admin.ops.runtime.evalIntervalHint')}
              value={draftAlert.evaluation_interval_seconds}
              min={1}
              max={86400}
              aria-invalid={!alertValidation.valid}
              onChange={(raw) =>
                updateDraft((draft) => {
                  draft.evaluation_interval_seconds = toNumberModel(raw)
                })
              }
            />

            <section className={form.section}>
              <h3 className={form.sectionTitle}>{t('admin.ops.runtime.metricThresholds')}</h3>
              <p className={form.hint}>{t('admin.ops.runtime.metricThresholdsHint')}</p>
              <div className={form.grid2}>
                {thresholdInput('sla_percent_min', t('admin.ops.runtime.slaMinPercent'), t('admin.ops.runtime.slaMinPercentHint'), {
                  min: 0,
                  max: 100,
                  step: 0.1,
                  placeholder: '99.5'
                })}
                {thresholdInput('ttft_p99_ms_max', t('admin.ops.runtime.ttftP99MaxMs'), t('admin.ops.runtime.ttftP99MaxMsHint'), {
                  min: 0,
                  step: 100,
                  placeholder: '500'
                })}
                {thresholdInput(
                  'request_error_rate_percent_max',
                  t('admin.ops.runtime.requestErrorRateMaxPercent'),
                  t('admin.ops.runtime.requestErrorRateMaxPercentHint'),
                  { min: 0, max: 100, step: 0.1, placeholder: '5' }
                )}
                {thresholdInput(
                  'upstream_error_rate_percent_max',
                  t('admin.ops.runtime.upstreamErrorRateMaxPercent'),
                  t('admin.ops.runtime.upstreamErrorRateMaxPercentHint'),
                  { min: 0, max: 100, step: 0.1, placeholder: '5' }
                )}
              </div>
            </section>

            <section className={form.section}>
              <h3 className={form.sectionTitle}>{t('admin.ops.runtime.silencing.title')}</h3>
              {switchRow(t('admin.ops.runtime.silencing.enabled'), !!silencing?.enabled, (v) =>
                updateDraft((draft) => {
                  draft.silencing.enabled = v
                })
              )}

              {silencing?.enabled && (
                <div className={form.stack}>
                  <Input
                    label={t('admin.ops.runtime.silencing.globalUntil')}
                    hint={t('admin.ops.runtime.silencing.untilHint')}
                    className={form.mono}
                    value={silencing.global_until_rfc3339}
                    placeholder="2026-01-05T00:00:00Z"
                    onChange={(raw) =>
                      updateDraft((draft) => {
                        draft.silencing.global_until_rfc3339 = raw
                      })
                    }
                  />

                  <Input
                    label={t('admin.ops.runtime.silencing.reason')}
                    value={silencing.global_reason}
                    placeholder={t('admin.ops.runtime.silencing.reasonPlaceholder')}
                    onChange={(raw) =>
                      updateDraft((draft) => {
                        draft.silencing.global_reason = raw
                      })
                    }
                  />

                  <div className={form.section}>
                    <div className={panel.header}>
                      <div>
                        <h4 className={form.subTitle}>{t('admin.ops.runtime.silencing.entries.title')}</h4>
                        <p className={form.hint}>{t('admin.ops.runtime.silencing.entries.hint')}</p>
                      </div>
                      <Button type="button" size="sm" variant="secondary" onClick={addSilenceEntry}>
                        {t('admin.ops.runtime.silencing.entries.add')}
                      </Button>
                    </div>

                    {entries.length === 0 ? (
                      <div className={panel.muted}>{t('admin.ops.runtime.silencing.entries.empty')}</div>
                    ) : (
                      <div className={form.stack}>
                        {entries.map((entry, idx) => (
                          <div key={idx} className={styles.entry}>
                            <div className={panel.header}>
                              <span className={form.subTitle}>
                                {t('admin.ops.runtime.silencing.entries.entryTitle', { n: idx + 1 })}
                              </span>
                              <Button type="button" size="sm" variant="danger" onClick={() => removeSilenceEntry(idx)}>
                                {t('common.delete')}
                              </Button>
                            </div>

                            <div className={form.grid2}>
                              <Input
                                label={t('admin.ops.runtime.silencing.entries.ruleId')}
                                className={form.mono}
                                value={typeof (entry as any).rule_id === 'number' ? String((entry as any).rule_id) : ''}
                                placeholder={t('admin.ops.runtime.silencing.entries.ruleIdPlaceholder')}
                                onChange={(raw) => updateSilenceEntryRuleId(idx, raw)}
                              />
                              <Input
                                label={t('admin.ops.runtime.silencing.entries.severities')}
                                className={form.mono}
                                value={Array.isArray((entry as any).severities) ? (entry as any).severities.join(', ') : ''}
                                placeholder={t('admin.ops.runtime.silencing.entries.severitiesPlaceholder')}
                                onChange={(raw) => updateSilenceEntrySeverities(idx, raw)}
                              />
                              <Input
                                label={t('admin.ops.runtime.silencing.entries.until')}
                                className={form.mono}
                                value={(entry as any).until_rfc3339}
                                placeholder="2026-01-05T00:00:00Z"
                                onChange={(raw) =>
                                  updateEntry(idx, (e) => {
                                    ;(e as any).until_rfc3339 = raw
                                  })
                                }
                              />
                              <Input
                                label={t('admin.ops.runtime.silencing.entries.reason')}
                                value={(entry as any).reason}
                                placeholder={t('admin.ops.runtime.silencing.reasonPlaceholder')}
                                onChange={(raw) =>
                                  updateEntry(idx, (e) => {
                                    ;(e as any).reason = raw
                                  })
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <details className={form.details}>
              <summary>{t('admin.ops.runtime.advancedSettingsSummary')}</summary>
              <div className={form.detailsBody}>
                <div className={form.grid2}>
                  {switchRow(t('admin.ops.runtime.lockEnabled'), draftAlert.distributed_lock.enabled, (v) =>
                    updateDraft((draft) => {
                      draft.distributed_lock.enabled = v
                    })
                  )}
                  <div className={form.span2}>
                    <Input
                      label={t('admin.ops.runtime.lockKey')}
                      className={form.mono}
                      value={draftAlert.distributed_lock.key}
                      hint={
                        draftAlert.distributed_lock.enabled
                          ? t('admin.ops.runtime.validation.lockKeyHint', { prefix: 'ops:' })
                          : undefined
                      }
                      onChange={(raw) =>
                        updateDraft((draft) => {
                          draft.distributed_lock.key = raw
                        })
                      }
                    />
                  </div>
                  <Input
                    type="number"
                    label={t('admin.ops.runtime.lockTTLSeconds')}
                    className={form.mono}
                    value={draftAlert.distributed_lock.ttl_seconds}
                    min={1}
                    max={86400}
                    onChange={(raw) =>
                      updateDraft((draft) => {
                        draft.distributed_lock.ttl_seconds = toNumberModel(raw)
                      })
                    }
                  />
                </div>
              </div>
            </details>
          </div>
        )}
      </BaseDialog>
    </>
  )
}
