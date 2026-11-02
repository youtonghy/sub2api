/**
 * OpenCode Go 用量窗口（滚动 / 周 / 月）与手动查询，对应 Vue 版 OpenCodeGoUsageCell.vue。
 */
import { RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { useI18n } from '@/i18n/useI18n'
import type { Account, OpenCodeGoUsageState } from '@/types'
import UsageProgressBar from './UsageProgressBar'
import styles from './usageCells.module.css'

export interface OpenCodeGoUsageCellProps {
  account: Account
  onUpdated?: (state: OpenCodeGoUsageState) => void
}

export default function OpenCodeGoUsageCell({ account, onUpdated }: OpenCodeGoUsageCellProps) {
  const { t } = useI18n()
  const [state, setState] = useState(account.opencode_go_usage)
  // 账号行快照更新时同步（Vue 版 watch(account.opencode_go_usage)）
  const [prevUsage, setPrevUsage] = useState(account.opencode_go_usage)
  if (prevUsage !== account.opencode_go_usage) {
    setPrevUsage(account.opencode_go_usage)
    setState(account.opencode_go_usage)
  }
  const [refreshing, setRefreshingState] = useState(false)
  const refreshingRef = useRef(false)
  const snapshot = state?.snapshot

  const setRefreshing = (value: boolean) => {
    refreshingRef.current = value
    setRefreshingState(value)
  }

  const statusLabel =
    snapshot?.status === 'unauthorized'
      ? t('admin.accounts.opencodeGo.unauthorized')
      : snapshot?.status === 'failed'
        ? t('admin.accounts.opencodeGo.failed')
        : t('admin.accounts.opencodeGo.ok')

  const refreshUsage = async () => {
    if (refreshingRef.current) return
    setRefreshing(true)
    try {
      const next = await adminAPI.accounts.refreshOpenCodeGoUsage(account.id)
      setState(next)
      onUpdated?.(next)
    } catch (error) {
      console.error('Failed to refresh OpenCode Go usage:', error)
    } finally {
      setRefreshing(false)
    }
  }

  if (!state?.eligible) return <span className={styles.dash}>-</span>

  return (
    <div className={styles.stack} data-testid="opencode-go-usage-cell">
      {snapshot?.data?.rolling ? (
        <UsageProgressBar
          label={t('admin.accounts.opencodeGo.rollingShort')}
          utilization={snapshot.data.rolling.percent}
          resetsAt={snapshot.data.rolling.resets_at}
          color="indigo"
          data-testid="opencode-go-rolling"
        />
      ) : null}
      {snapshot?.data?.weekly ? (
        <UsageProgressBar
          label={t('admin.accounts.opencodeGo.weeklyShort')}
          utilization={snapshot.data.weekly.percent}
          resetsAt={snapshot.data.weekly.resets_at}
          color="emerald"
          data-testid="opencode-go-weekly"
        />
      ) : null}
      {snapshot?.data?.monthly ? (
        <UsageProgressBar
          label={t('admin.accounts.opencodeGo.monthlyShort')}
          utilization={snapshot.data.monthly.percent}
          resetsAt={snapshot.data.monthly.resets_at}
          color="amber"
          data-testid="opencode-go-monthly"
        />
      ) : null}
      {snapshot && snapshot.status !== 'ok' ? (
        <span
          className={styles.tag}
          data-tone={snapshot.status === 'unauthorized' ? 'warning' : 'danger'}
          data-testid="opencode-go-status-badge"
        >
          {statusLabel}
        </span>
      ) : null}
      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.action}
          disabled={refreshing}
          data-testid="opencode-go-usage-query"
          onClick={() => void refreshUsage()}
        >
          <RefreshCw className={[styles.actionIcon, refreshing ? styles.spin : ''].join(' ')} aria-hidden="true" />
          {t('admin.accounts.usageWindow.activeQuery')}
        </button>
      </div>
    </div>
  )
}
