import type { UserMonitorDetail, UserMonitorView } from '@/api/channelMonitor'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import EmptyState from '@/components/common/EmptyState'
import { useI18n } from '@/i18n/useI18n'
import MonitorCard from './MonitorCard'
import styles from './MonitorCardGrid.module.css'

export interface MonitorCardGridProps {
  items: UserMonitorView[]
  window: '7d' | '15d' | '30d'
  countdownSeconds: number
  loading: boolean
  detailCache: Record<number, UserMonitorDetail>
  onCardClick?: (item: UserMonitorView) => void
}

/** 渠道状态卡片网格（含加载骨架与空状态），对应 Vue 版 MonitorCardGrid.vue */
export default function MonitorCardGrid({ items, window, countdownSeconds, loading, detailCache, onCardClick }: MonitorCardGridProps) {
  const { t } = useI18n()

  function resolveAvailability(item: UserMonitorView): number | null {
    if (window === '7d') {
      return item.availability_7d ?? null
    }
    const detail = detailCache[item.id]
    if (!detail) return null
    const primary = detail.models.find((m) => m.model === item.primary_model)
    if (!primary) return null
    return window === '15d' ? (primary.availability_15d ?? null) : (primary.availability_30d ?? null)
  }

  if (loading && items.length === 0) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.skeletonCard}>
            <Skeleton label={t('common.loading')} lines={4} avatar />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return <EmptyState title={t('channelStatus.empty.title')} description={t('channelStatus.empty.description')} />
  }

  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <MonitorCard
          key={item.id}
          item={item}
          window={window}
          availabilityValue={resolveAvailability(item)}
          countdownSeconds={countdownSeconds}
          onClick={() => onCardClick?.(item)}
        />
      ))}
    </div>
  )
}
