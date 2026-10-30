/** 网页搜索模拟（服务商配置随整表保存，测试与重置用量为即时接口调用） */
import { useState } from 'react'
import { ChevronRight, Copy, Eye, EyeOff } from 'lucide-react'

import { adminAPI } from '@/api'
import type { WebSearchProviderConfig, WebSearchTestResult } from '@/api/admin/settings'
import { Button } from '@/components/arc/button/button'
import { Field, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import BaseDialog from '@/components/common/BaseDialog'
import ProxySelector from '@/components/common/ProxySelector'
import Select from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { extractApiErrorMessage } from '@/utils/apiError'
import { useSettings } from './settingsContext'
import { DEFAULT_WEB_SEARCH_QUOTA_LIMIT, formatSubscribedAt, parseSubscribedAt } from './settingsHelpers'
import styles from './WebSearchEmulationSection.module.css'

function quotaPercentage(provider: WebSearchProviderConfig): number {
  if (!provider.quota_limit || provider.quota_limit <= 0) return 0
  return ((provider.quota_used ?? 0) / provider.quota_limit) * 100
}

function quotaLabel(provider: WebSearchProviderConfig): string {
  return `${provider.quota_used ?? 0} / ${provider.quota_limit != null && provider.quota_limit > 0 ? provider.quota_limit : '∞'}`
}

export default function WebSearchEmulationSection() {
  const { t } = useI18n()
  const { draft, updateDraft, webSearchProxies } = useSettings()
  const config = draft.webSearchConfig
  const [expanded, setExpanded] = useState<boolean[]>([])
  const [keyVisible, setKeyVisible] = useState<boolean[]>([])
  const [testQuery, setTestQuery] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<WebSearchTestResult | null>(null)
  const [testDialogOpen, setTestDialogOpen] = useState(false)

  function setProviders(next: (providers: WebSearchProviderConfig[]) => WebSearchProviderConfig[]) {
    updateDraft((d) => ({ webSearchConfig: { ...d.webSearchConfig, providers: next(d.webSearchConfig.providers) } }))
  }
  function updateProvider(index: number, patch: Partial<WebSearchProviderConfig>) {
    setProviders((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function addProvider() {
    const idx = config.providers.length
    setProviders((list) => [
      ...list,
      {
        type: 'brave',
        api_key: '',
        api_key_configured: false,
        quota_limit: DEFAULT_WEB_SEARCH_QUOTA_LIMIT,
        subscribed_at: null,
        proxy_id: null,
        expires_at: null
      }
    ])
    setExpanded((prev) => {
      const next = [...prev]
      next[idx] = true
      return next
    })
  }

  function removeProvider(idx: number) {
    setProviders((list) => list.filter((_, i) => i !== idx))
    // Re-index expanded and visible flags after removal
    setExpanded((prev) => prev.filter((_, i) => i !== idx))
    setKeyVisible((prev) => prev.filter((_, i) => i !== idx))
  }

  async function resetUsage(idx: number) {
    const provider = config.providers[idx]
    if (!provider) return
    if (!confirm(t('admin.settings.webSearchEmulation.resetUsageConfirm'))) return
    try {
      await adminAPI.settings.resetWebSearchUsage({ provider_type: provider.type })
      updateProvider(idx, { quota_used: 0 })
      useAppStore.getState().showSuccess(t('admin.settings.webSearchEmulation.resetUsageSuccess'))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    }
  }

  async function copyApiKey(idx: number) {
    const key = config.providers[idx]?.api_key
    if (!key) {
      useAppStore.getState().showError(t('admin.settings.webSearchEmulation.apiKeyPlaceholder'))
      return
    }
    try {
      await navigator.clipboard.writeText(key)
      useAppStore.getState().showSuccess(t('admin.settings.webSearchEmulation.copied'))
    } catch {
      useAppStore.getState().showError(t('common.error'))
    }
  }

  async function runTest() {
    setTestLoading(true)
    setTestResult(null)
    try {
      const query = testQuery.trim() || t('admin.settings.webSearchEmulation.testDefaultQuery')
      setTestResult(await adminAPI.settings.testWebSearchEmulation(query))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <SettingsRegion title={t('admin.settings.webSearchEmulation.title')} description={t('admin.settings.webSearchEmulation.description')}>
      <ToggleRow
        label={t('admin.settings.webSearchEmulation.enabled')}
        description={t('admin.settings.webSearchEmulation.enabledHint')}
        checked={config.enabled}
        onChange={(enabled) => updateDraft((d) => ({ webSearchConfig: { ...d.webSearchConfig, enabled } }))}
      />
      {config.enabled ? (
        <div className={s.column}>
          <div className={s.itemHead}>
            <span className={s.label}>{t('admin.settings.webSearchEmulation.providers')}</span>
            <Button type="button" variant="secondary" size="sm" onClick={addProvider}>
              {t('admin.settings.webSearchEmulation.addProvider')}
            </Button>
          </div>
          {config.providers.length === 0 ? <p className={s.empty}>{t('admin.settings.webSearchEmulation.noProviders')}</p> : null}
          {config.providers.map((provider, pIdx) => {
            const open = Boolean(expanded[pIdx])
            const visible = Boolean(keyVisible[pIdx])
            const percent = quotaPercentage(provider)
            return (
              <div key={pIdx} className={styles.provider}>
                <div className={styles.providerHead}>
                  <button
                    type="button"
                    className={s.iconButton}
                    aria-expanded={open}
                    aria-label={provider.type}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = [...prev]
                        next[pIdx] = !next[pIdx]
                        return next
                      })
                    }
                  >
                    <ChevronRight size={14} className={styles.chevron} data-open={open || undefined} aria-hidden="true" />
                  </button>
                  <div className={styles.typeSelect}>
                    <Select
                      value={provider.type}
                      options={[
                        { value: 'brave', label: 'Brave Search' },
                        { value: 'tavily', label: 'Tavily' }
                      ]}
                      onChange={(value) => updateProvider(pIdx, { type: value as WebSearchProviderConfig['type'] })}
                    />
                  </div>
                  <span className={s.hint}>{quotaLabel(provider)}</span>
                  {!open && provider.api_key_configured ? (
                    <span className={s.success}>{t('admin.settings.webSearchEmulation.apiKeyConfigured')}</span>
                  ) : null}
                  <span className={s.grow} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeProvider(pIdx)}>
                    {t('admin.settings.webSearchEmulation.removeProvider')}
                  </Button>
                </div>
                {open ? (
                  <div className={styles.providerBody}>
                    <Field label={t('admin.settings.webSearchEmulation.apiKey')}>
                      <div className={s.inputWithSuffix}>
                        <input
                          type={visible ? 'text' : 'password'}
                          className={s.input}
                          value={provider.api_key}
                          placeholder={
                            provider.api_key_configured ? '••••••••' : t('admin.settings.webSearchEmulation.apiKeyPlaceholder')
                          }
                          onChange={(e) => updateProvider(pIdx, { api_key: e.target.value })}
                        />
                        {provider.api_key || provider.api_key_configured ? (
                          <span className={styles.keyActions}>
                            <button
                              type="button"
                              className={s.iconButton}
                              title={
                                visible ? t('admin.settings.webSearchEmulation.hideApiKey') : t('admin.settings.webSearchEmulation.showApiKey')
                              }
                              aria-label={
                                visible ? t('admin.settings.webSearchEmulation.hideApiKey') : t('admin.settings.webSearchEmulation.showApiKey')
                              }
                              onClick={() =>
                                setKeyVisible((prev) => {
                                  const next = [...prev]
                                  next[pIdx] = !next[pIdx]
                                  return next
                                })
                              }
                            >
                              {visible ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                            </button>
                            <button
                              type="button"
                              className={s.iconButton}
                              title={t('admin.settings.webSearchEmulation.copyApiKey')}
                              aria-label={t('admin.settings.webSearchEmulation.copyApiKey')}
                              disabled={!provider.api_key}
                              onClick={() => void copyApiKey(pIdx)}
                            >
                              <Copy size={14} aria-hidden="true" />
                            </button>
                          </span>
                        ) : null}
                      </div>
                    </Field>
                    <div className={s.grid2}>
                      <Field label={t('admin.settings.webSearchEmulation.quotaLimit')} hint={t('admin.settings.webSearchEmulation.quotaLimitHint')}>
                        <input
                          type="number"
                          min="1"
                          className={s.input}
                          placeholder="∞"
                          value={provider.quota_limit ?? ''}
                          onChange={(e) => updateProvider(pIdx, { quota_limit: numberInputValue(e.target.value) as number })}
                        />
                      </Field>
                      <Field
                        label={t('admin.settings.webSearchEmulation.subscribedAt')}
                        hint={t('admin.settings.webSearchEmulation.subscribedAtHint')}
                      >
                        <input
                          type="date"
                          className={s.input}
                          value={formatSubscribedAt(provider.subscribed_at)}
                          onChange={(e) => updateProvider(pIdx, { subscribed_at: parseSubscribedAt(e.target.value) })}
                        />
                      </Field>
                    </div>
                    <div className={s.inline}>
                      <span className={s.hint}>{t('admin.settings.webSearchEmulation.quotaUsage')}:</span>
                      {provider.quota_limit != null && provider.quota_limit > 0 ? (
                        <div className={styles.usageTrack}>
                          <div
                            className={styles.usageBar}
                            data-level={percent > 90 ? 'danger' : percent > 70 ? 'warning' : 'success'}
                            style={{ width: `${Math.min(percent, 100)}%` }}
                          />
                        </div>
                      ) : (
                        <span className={s.grow} />
                      )}
                      <span className={s.hint}>{quotaLabel(provider)}</span>
                      {(provider.quota_used ?? 0) > 0 ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => void resetUsage(pIdx)}>
                          {t('admin.settings.webSearchEmulation.resetUsage')}
                        </Button>
                      ) : null}
                    </div>
                    <div className={styles.proxyRow}>
                      <Field label={t('admin.settings.webSearchEmulation.proxy')} className={s.grow}>
                        <ProxySelector
                          value={provider.proxy_id}
                          proxies={webSearchProxies}
                          onChange={(proxy_id) => updateProvider(pIdx, { proxy_id })}
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setTestResult(null)
                          setTestDialogOpen(true)
                        }}
                      >
                        {t('admin.settings.webSearchEmulation.test')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <BaseDialog
        show={testDialogOpen}
        title={t('admin.settings.webSearchEmulation.testResultTitle')}
        closeOnClickOutside
        onClose={() => setTestDialogOpen(false)}
        footer={
          <Button type="button" variant="secondary" size="sm" onClick={() => setTestDialogOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={s.column}>
          <div className={s.inline}>
            <input
              type="text"
              className={cx(s.input, s.grow)}
              style={{ flex: '1 1 12rem', width: 'auto' }}
              value={testQuery}
              placeholder={t('admin.settings.webSearchEmulation.testDefaultQuery')}
              onChange={(e) => setTestQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runTest()
                }
              }}
            />
            <Button type="button" size="sm" disabled={testLoading} onClick={() => void runTest()}>
              {testLoading ? t('admin.settings.webSearchEmulation.testing') : t('admin.settings.webSearchEmulation.test')}
            </Button>
          </div>
          {testResult ? (
            <div className={styles.results}>
              <p className={s.label}>
                {t('admin.settings.webSearchEmulation.testResultProvider')}: {testResult.provider}
              </p>
              {testResult.results.length === 0 ? <p className={s.hint}>{t('admin.settings.webSearchEmulation.testNoResults')}</p> : null}
              {testResult.results.map((r, rIdx) => (
                <div key={rIdx} className={styles.result}>
                  <a href={r.url} target="_blank" rel="noreferrer" className={s.link}>
                    {r.title}
                  </a>
                  <p className={s.hint}>{r.snippet}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </BaseDialog>
    </SettingsRegion>
  )
}
