/**
 * Ollama Cloud 用量窗口（5h / 7d）与手动查询，对应 Vue 版 OllamaCloudUsageCell.vue。
 */
import { RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { useI18n } from '@/i18n/useI18n'
import type { Account, OllamaCloudUsageState } from '@/types'
import UsageProgressBar from './UsageProgressBar'
import styles from './usageCells.module.css'

export interface OllamaCloudUsageCellProps {
  account: Account
  onUpdated?: (state: OllamaCloudUsageState) => void
}

export default function OllamaCloudUsageCell({ account, onUpdated }: OllamaCloudUsageCellProps) {
  const { t } = useI18n()
  const [state, setState] = useState(account.ollama_cloud_usage)
  // 账号行快照更新时同步（Vue 版 watch(account.ollama_cloud_usage)）
  const [prevUsage, setPrevUsage] = useState(account.ollama_cloud_usage)
  if (prevUsage !== account.ollama_cloud_usage) {
    setPrevUsage(account.ollama_cloud_usage)
    setState(account.ollama_cloud_usage)
  }
  const [refreshing, setRefreshingState] = useState(false)
  const refreshingRef = useRef(false)
  const snapshot = state?.snapshot

  const setRefreshing = (value: boolean) => {
    refreshingRef.current = value
    setRefreshingState(value)
  }

  const refreshUsage = async () => {
    if (refreshingRef.current) return
    setRefreshing(true)
    try {
      const next = await adminAPI.accounts.refreshOllamaCloudUsage(account.id)
      setState(next)
      onUpdated?.(next)
    } catch (error) {
      console.error('Failed to refresh Ollama Cloud usage:', error)
    } finally {
      setRefreshing(false)
    }
  }

  if (!state?.eligible) return <span className={styles.dash}>-</span>

  return (
    <div className={styles.stack} data-testid="ollama-cloud-usage-cell">
      {snapshot?.data?.five_hour ? (
        <UsageProgressBar
          label="5h"
          utilization={snapshot.data.five_hour.used_percent}
          resetsAt={snapshot.data.five_hour.reset_at}
          color="indigo"
          data-testid="ollama-cloud-five-hour"
        />
      ) : null}
      {snapshot?.data?.seven_day ? (
        <UsageProgressBar
          label="7d"
          utilization={snapshot.data.seven_day.used_percent}
          resetsAt={snapshot.data.seven_day.reset_at}
          color="emerald"
          data-testid="ollama-cloud-seven-day"
        />
      ) : null}
      {state.configured ? (
        <div className={styles.actionsRow}>
          <button
            type="button"
            className={styles.action}
            disabled={refreshing}
            data-testid="ollama-cloud-usage-query"
            onClick={() => void refreshUsage()}
          >
            <RefreshCw className={[styles.actionIcon, refreshing ? styles.spin : ''].join(' ')} aria-hidden="true" />
            {t('admin.accounts.usageWindow.activeQuery')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
