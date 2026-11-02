import type { UserMonitorView } from '@/api/channelMonitor'
import { platformTone } from '@/components/admin/channel/platformTone'
import { Badge } from '@/components/arc/badge/badge'
import MonitorQuotaView from '@/components/common/MonitorQuotaView'
import { useChannelMonitorFormat } from '@/composables/useChannelMonitorFormat'
import { useI18n } from '@/i18n/useI18n'
import { isChannelMonitorQuotaVisible } from '@/utils/featureFlags'
import MonitorAvailabilityRow from './MonitorAvailabilityRow'
import MonitorMetricPair from './MonitorMetricPair'
import MonitorTimeline from './MonitorTimeline'
import ProviderIcon from './ProviderIcon'
import styles from './MonitorCard.module.css'

export interface MonitorCardProps {
  item: UserMonitorView
  window: '7d' | '15d' | '30d'
  availabilityValue: number | null
  countdownSeconds: number
  onClick?: () => void
}

/** 渠道状态卡片，对应 Vue 版 MonitorCard.vue；服务商配色沿用平台色调（服务商 id 与平台 id 一致） */
export default function MonitorCard({ item, window, availabilityValue, countdownSeconds, onClick }: MonitorCardProps) {
  const { t } = useI18n()
  const { statusLabel, statusTone, providerLabel, formatLatency, formatMonitorModel } = useChannelMonitorFormat()

  // 配额模式：最新用量/余额快照（服务端已按系统开关剥离，此处 flag 为纵深防御）
  const quotaVisible = isChannelMonitorQuotaVisible() && !!item.latest_quota
  const availabilityLabel = `${t('monitorCommon.availabilityPrefix')} · ${t(`channelStatus.windowTab.${window}`)}`
  const extraCount = item.extra_models?.length ?? 0
  const extraModelsCountLabel = extraCount === 0 ? undefined : t('monitorCommon.extraModelsCount', { n: extraCount })

  return (
    <button type="button" className={styles.card} onClick={() => onClick?.()}>
      {/* Header: icon + name/model + status chip */}
      <div className={styles.header}>
        <span {...platformTone(item.provider, 'tag', styles.providerIcon)}>
          <ProviderIcon provider={item.provider} size={20} />
        </span>
        <div className={styles.headerText}>
          <div className={styles.name}>{item.name}</div>
          <div className={styles.subline}>
            <span {...platformTone(item.provider, 'tag', styles.providerBadge)}>{providerLabel(item.provider)}</span>
            {/* 纯配额模式主模型是占位符 "quota"，展示层替换为本地化「配额」标签 */}
            <span className={styles.model}>{formatMonitorModel(item.primary_model)}</span>
            {item.group_name && (
              <Badge size="sm" tone="neutral">
                {item.group_name}
              </Badge>
            )}
          </div>
        </div>
        <Badge size="sm" tone={statusTone(item.primary_status)}>
          {statusLabel(item.primary_status)}
        </Badge>
      </div>

      {/* Metrics */}
      <MonitorMetricPair
        primaryIcon="bolt"
        primaryLabel={t('monitorCommon.dialogLatency')}
        primaryValue={formatLatency(item.primary_latency_ms)}
        primaryUnit="ms"
        secondaryIcon="globe"
        secondaryLabel={t('monitorCommon.endpointPing')}
        secondaryValue={formatLatency(item.primary_ping_latency_ms)}
        secondaryUnit="ms"
      />

      {quotaVisible && (
        <div className={styles.quota}>
          <MonitorQuotaView snapshot={item.latest_quota} />
        </div>
      )}

      <div className={styles.divider} />

      <MonitorAvailabilityRow windowLabel={availabilityLabel} value={availabilityValue} samplesLabel={extraModelsCountLabel} />

      <MonitorTimeline buckets={item.timeline} countdownSeconds={countdownSeconds} />
    </button>
  )
}
