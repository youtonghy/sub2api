/**
 * Grok OAuth 上游额度探测按钮，对应 Vue 版 GrokQuotaProbeCell.vue。
 */
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { GrokQuotaProbeResult } from '@/api/admin/grok'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import styles from './usageCells.module.css'

export interface GrokQuotaProbeCellProps {
  account: Account
  /** When true, only show the probe button (+ errors). No duplicate weekly summary. */
  compact?: boolean
  onProbed?: (result: GrokQuotaProbeResult) => void
  className?: string
}

/** 切换账号 id 时整体重建，清空探测结果（Vue 版 watch(account.id) 重置） */
export default function GrokQuotaProbeCell(props: GrokQuotaProbeCellProps) {
  if (props.account.platform !== 'grok' || props.account.type !== 'oauth') return null
  return <GrokQuotaProbeCellInner key={props.account.id} {...props} />
}

function GrokQuotaProbeCellInner({ account, compact = false, onProbed, className }: GrokQuotaProbeCellProps) {
  const { t } = useI18n()
  const [loading, setLoadingState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<GrokQuotaProbeResult | null>(null)
  const loadingRef = useRef(false)
  const disposed = useRef(false)

  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
    }
  }, [])

  const setLoading = (value: boolean) => {
    loadingRef.current = value
    setLoadingState(value)
  }

  const extractErrorMessage = (e: unknown): string => {
    const err = e as {
      message?: string
      reason?: string
      response?: { data?: { message?: string; error?: string } }
    }
    return (
      err?.message || err?.reason || err?.response?.data?.message || err?.response?.data?.error || t('common.error')
    )
  }

  const summary = (() => {
    if (compact || !data) return ''
    // Non-compact fallback (rarely used): brief weekly percent if present.
    const billing = data.billing
    if (billing?.period_type?.toLowerCase() === 'weekly' && billing.usage_percent != null) {
      return t('admin.accounts.usageWindow.grokWeeklyUsage', {
        percent: Math.round(Math.min(100, Math.max(0, billing.usage_percent)))
      })
    }
    return ''
  })()

  const truncatedError = error ? (error.length > 80 ? `${error.slice(0, 80)}...` : error) : ''

  const handleProbe = async () => {
    if (loadingRef.current) return
    setLoading(true)
    setError(null)
    try {
      const result = await adminAPI.grok.queryQuota(account.id)
      if (disposed.current) return
      setData(result)
      setError(result.probe_error || null)
      onProbed?.(result)
    } catch (e) {
      if (!disposed.current) setError(extractErrorMessage(e))
    } finally {
      if (!disposed.current) setLoading(false)
    }
  }

  return (
    <div className={[styles.stack, className].filter(Boolean).join(' ')}>
      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.action}
          disabled={loading}
          title={t('admin.accounts.usageWindow.grokProbeTooltip')}
          onClick={() => void handleProbe()}
        >
          <RefreshCw className={[styles.actionIcon, loading ? styles.spin : ''].join(' ')} aria-hidden="true" />
          {t('admin.accounts.usageWindow.grokProbe')}
        </button>
      </div>

      {/* Compact mode: parent already shows 7d/30d/prepaid or 24h — only surface errors. */}
      {!compact && summary ? <div className={styles.mutedLine}>{summary}</div> : null}
      {error ? (
        <div className={styles.errorTiny} title={error}>
          {truncatedError}
        </div>
      ) : null}
    </div>
  )
}
