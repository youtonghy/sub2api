import { Check, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import Toggle from '@/components/common/Toggle'
import { adminAPI } from '@/api/admin'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { Account, OllamaCloudUsageState, OllamaCloudUsageWindow } from '@/types'
import { extractApiErrorMessage, extractI18nErrorMessage } from '@/utils/apiError'
import styles from './AccountForm.module.css'
import own from './OllamaCloudUsageSettings.module.css'

export interface OllamaCloudUsageSettingsProps {
  account: Account
  /** Vue 版 updated */
  onUpdated?: (state: OllamaCloudUsageState) => void
}

/** Ollama Cloud 用量会话设置（编辑账号时显示）：会话写入、删除、手动刷新与自动刷新 */
export default function OllamaCloudUsageSettings({ account, onUpdated }: OllamaCloudUsageSettingsProps) {
  const { t } = useI18n()
  const [state, setState] = useState<OllamaCloudUsageState | null>(account.ollama_cloud_usage ?? null)
  const [session, setSession] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const accountId = account.id
  const onUpdatedRef = useRef(onUpdated)
  useEffect(() => {
    onUpdatedRef.current = onUpdated
  })

  // 切换账号时重置为该账号自带的状态（Vue 版 watch(account.id)）
  const [prevAccountId, setPrevAccountId] = useState(accountId)
  if (prevAccountId !== accountId) {
    setPrevAccountId(accountId)
    setState(account.ollama_cloud_usage ?? null)
    setSession('')
  }

  const applyState = (next: OllamaCloudUsageState) => {
    setState(next)
    onUpdatedRef.current?.(next)
  }

  // 账号自带状态时直接使用，避免挂载后立即重复 GET
  const hasInitialState = !!account.ollama_cloud_usage
  useEffect(() => {
    if (hasInitialState) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const next = await adminAPI.accounts.getOllamaCloudUsage(accountId)
        if (cancelled) return
        setState(next)
        onUpdatedRef.current?.(next)
      } catch (error) {
        if (!cancelled) {
          useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.ollamaCloud.loadFailed')))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在账号切换时加载（与 Vue 版一致）
  }, [accountId])

  const snapshot = state?.snapshot

  const statusLabel = !snapshot
    ? t('admin.accounts.ollamaCloud.notRefreshed')
    : snapshot.status === 'unauthorized'
      ? t('admin.accounts.ollamaCloud.unauthorized')
      : snapshot.status === 'failed'
        ? t('admin.accounts.ollamaCloud.failed')
        : t('admin.accounts.ollamaCloud.ok')

  const modelSummary =
    snapshot?.data?.models
      ?.map((model) => {
        const window =
          model.window === 'five_hour'
            ? t('admin.accounts.ollamaCloud.fiveHourShort')
            : t('admin.accounts.ollamaCloud.sevenDayShort')
        return `${window} ${model.model}: ${model.requests}`
      })
      .join(', ') || '-'

  const formatPercent = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(value % 1 ? 1 : 0)}%` : '-'
  const formatDate = (value?: string) => {
    if (!value) return '-'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  }
  const windowSummary = (window?: OllamaCloudUsageWindow) => {
    if (!window) return '-'
    const reset = window.reset_at ? formatDate(window.reset_at) : window.reset_text
    return reset
      ? t('admin.accounts.ollamaCloud.windowWithReset', { percent: formatPercent(window.used_percent), reset })
      : formatPercent(window.used_percent)
  }

  const saveSession = async () => {
    if (!session.trim()) return
    setSaving(true)
    try {
      applyState(await adminAPI.accounts.saveOllamaCloudUsageSession(accountId, session))
      setSession('')
      useAppStore.getState().showSuccess(t('admin.accounts.ollamaCloud.sessionSaved'))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.ollamaCloud.sessionSaveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const deleteSession = async () => {
    setSaving(true)
    setShowDeleteConfirm(false)
    try {
      applyState(await adminAPI.accounts.deleteOllamaCloudUsageSession(accountId))
      setSession('')
      useAppStore.getState().showSuccess(t('admin.accounts.ollamaCloud.sessionDeleted'))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.ollamaCloud.sessionDeleteFailed')))
    } finally {
      setSaving(false)
    }
  }

  const setAutoRefresh = async (enabled: boolean) => {
    setSaving(true)
    try {
      applyState(await adminAPI.accounts.setOllamaCloudUsageAutoRefresh(accountId, enabled))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.ollamaCloud.autoRefreshFailed')))
    } finally {
      setSaving(false)
    }
  }

  const refreshUsage = async () => {
    setRefreshing(true)
    try {
      applyState(await adminAPI.accounts.refreshOllamaCloudUsage(accountId))
      useAppStore.getState().showSuccess(t('admin.accounts.ollamaCloud.refreshSuccess'))
    } catch (error) {
      useAppStore
        .getState()
        .showError(
          extractI18nErrorMessage(error, t, 'admin.accounts.ollamaCloud.errors', t('admin.accounts.ollamaCloud.refreshFailed'))
        )
    } finally {
      setRefreshing(false)
    }
  }

  if (!state?.eligible) return null

  return (
    <section className={own.section} data-testid="ollama-cloud-usage-settings">
      <div className={own.header}>
        <div className={own.heading}>
          <h3 className={own.title}>{t('admin.accounts.ollamaCloud.title')}</h3>
          <p className={styles.hint}>{t('admin.accounts.ollamaCloud.sessionSecurityHint')}</p>
        </div>
        <Badge tone={state.configured ? 'success' : 'neutral'} size="sm">
          {state.configured ? t('admin.accounts.ollamaCloud.configured') : t('admin.accounts.ollamaCloud.notConfigured')}
        </Badge>
      </div>

      {loading ? (
        <div className={own.loading}>
          <RefreshCw size={16} className={own.spin} aria-hidden="true" />
        </div>
      ) : (
        <>
          {!state.encryption_key_configured ? (
            <div className={styles.notice} data-tone="warning">
              {t('admin.accounts.ollamaCloud.encryptionKeyRequired')}
            </div>
          ) : null}

          {snapshot ? (
            <div className={own.details} data-testid="ollama-cloud-usage-details">
              <dl className={own.grid}>
                <dt>{t('admin.accounts.ollamaCloud.plan')}</dt>
                <dd>{snapshot.data?.plan || '-'}</dd>
                <dt>{t('admin.accounts.ollamaCloud.fiveHour')}</dt>
                <dd>{windowSummary(snapshot.data?.five_hour)}</dd>
                <dt>{t('admin.accounts.ollamaCloud.sevenDay')}</dt>
                <dd>{windowSummary(snapshot.data?.seven_day)}</dd>
                <dt>{t('admin.accounts.ollamaCloud.balance')}</dt>
                <dd>{snapshot.data?.balance || '-'}</dd>
                <dt>{t('admin.accounts.ollamaCloud.models')}</dt>
                <dd>{modelSummary}</dd>
                <dt>{t('admin.accounts.ollamaCloud.status')}</dt>
                <dd className={own.strong}>{statusLabel}</dd>
                <dt>{t('admin.accounts.ollamaCloud.updatedAt')}</dt>
                <dd>{formatDate(snapshot.fetched_at || snapshot.last_attempt_at)}</dd>
              </dl>
              {snapshot.last_error ? (
                <p className={own.lastError}>
                  {t(`admin.accounts.ollamaCloud.errors.${snapshot.last_error}`, snapshot.last_error)}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ollama-cloud-session">
              {t('admin.accounts.ollamaCloud.sessionLabel')}
            </label>
            <textarea
              id="ollama-cloud-session"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              rows={3}
              className={`${styles.textarea} ${styles.mono}`}
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore="true"
              placeholder={t('admin.accounts.ollamaCloud.sessionPlaceholder')}
            />
            <p className={styles.hint}>{t('admin.accounts.ollamaCloud.writeOnlyHint')}</p>
          </div>

          <div className={styles.row}>
            <Button
              type="button"
              size="sm"
              disabled={saving || !session.trim() || !state.encryption_key_configured}
              data-testid="ollama-cloud-session-save"
              onClick={() => void saveSession()}
            >
              <Check size={14} aria-hidden="true" />
              {t('common.save')}
            </Button>
            {state.configured ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={own.dangerText}
                disabled={saving}
                data-testid="ollama-cloud-session-delete"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t('admin.accounts.ollamaCloud.deleteSession')}
              </Button>
            ) : null}
            {state.configured ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={refreshing}
                data-testid="ollama-cloud-refresh"
                onClick={() => void refreshUsage()}
              >
                <RefreshCw size={14} aria-hidden="true" className={refreshing ? own.spin : undefined} />
                {t('admin.accounts.ollamaCloud.refreshNow')}
              </Button>
            ) : null}
          </div>

          {state.configured ? (
            <div className={own.autoRefresh}>
              <div className={own.heading}>
                <span className={styles.label}>{t('admin.accounts.ollamaCloud.autoRefresh')}</span>
                <p className={styles.hint}>{t('admin.accounts.ollamaCloud.autoRefreshHint')}</p>
              </div>
              <span data-testid="ollama-cloud-auto-refresh">
                <Toggle
                  value={state.auto_refresh_enabled}
                  disabled={saving}
                  aria-label={t('admin.accounts.ollamaCloud.autoRefresh')}
                  onChange={(value) => void setAutoRefresh(value)}
                />
              </span>
            </div>
          ) : null}
        </>
      )}

      <ConfirmDialog
        show={showDeleteConfirm}
        title={t('admin.accounts.ollamaCloud.deleteSession')}
        message={t('admin.accounts.ollamaCloud.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void deleteSession()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </section>
  )
}
