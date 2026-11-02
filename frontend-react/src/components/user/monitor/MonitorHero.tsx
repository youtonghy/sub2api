import { RefreshCw } from 'lucide-react'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import AutoRefreshButton from '@/components/common/AutoRefreshButton'
import { useI18n } from '@/i18n/useI18n'
import styles from './MonitorHero.module.css'

export type MonitorWindow = '7d' | '15d' | '30d'
export type OverallStatus = 'operational' | 'degraded'

/** useAutoRefresh 返回值中 MonitorHero 需要的部分 */
export interface MonitorHeroAutoRefresh {
  enabled: boolean
  intervalSeconds: number
  countdown: number
  intervals: readonly number[]
  setEnabled: (v: boolean) => void
  setInterval: (v: number) => void
}

export interface MonitorHeroProps {
  overallStatus: OverallStatus
  intervalSeconds: number
  window: MonitorWindow
  loading: boolean
  autoRefresh?: MonitorHeroAutoRefresh
  /** Vue 版 update:window */
  onWindowChange?: (value: MonitorWindow) => void
  onRefresh?: () => void
}

/** 渠道状态页工具栏：时间窗口切换、整体状态、手动刷新与自动刷新，对应 Vue 版 MonitorHero.vue */
export default function MonitorHero({ overallStatus, window, loading, autoRefresh, onWindowChange, onRefresh }: MonitorHeroProps) {
  const { t } = useI18n()

  const windowOptions: { value: MonitorWindow; label: string }[] = [
    { value: '7d', label: t('channelStatus.windowTab.7d') },
    { value: '15d', label: t('channelStatus.windowTab.15d') },
    { value: '30d', label: t('channelStatus.windowTab.30d') }
  ]

  return (
    <section className={styles.toolbar}>
      <SegmentedControl
        options={windowOptions}
        value={window}
        onValueChange={(value) => onWindowChange?.(value as MonitorWindow)}
      />

      <Badge
        tone={overallStatus === 'operational' ? 'success' : 'warning'}
        icon={<span className={styles.dot} data-status={overallStatus} />}
      >
        {t(`channelStatus.overall.${overallStatus}`)}
      </Badge>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={loading}
        title={t('common.refresh')}
        aria-label={t('common.refresh')}
        onClick={() => onRefresh?.()}
      >
        <RefreshCw size={16} strokeWidth={1.75} className={loading ? styles.spinning : undefined} aria-hidden="true" />
      </Button>

      {autoRefresh && (
        <AutoRefreshButton
          enabled={autoRefresh.enabled}
          intervalSeconds={autoRefresh.intervalSeconds}
          countdown={autoRefresh.countdown}
          intervals={autoRefresh.intervals}
          onEnabledChange={autoRefresh.setEnabled}
          onIntervalChange={autoRefresh.setInterval}
        />
      )}
    </section>
  )
}
