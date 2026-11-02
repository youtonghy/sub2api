import type { HTMLAttributes } from 'react'

import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { GroupPlatform, SubscriptionType } from '@/types'
import { formatPeakRateWindow, serverTimezoneLabel } from '@/utils/peak-rate'
import styles from './GroupBadge.module.css'
import PlatformIcon from './PlatformIcon'

export interface GroupBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  name: string
  platform?: GroupPlatform
  subscriptionType?: SubscriptionType
  rateMultiplier?: number
  /** 用户专属倍率 */
  userRateMultiplier?: number | null
  peakRateEnabled?: boolean
  peakStart?: string
  peakEnd?: string
  peakRateMultiplier?: number
  showRate?: boolean
  /** Allow full group names to wrap in layouts that have room for multiple lines. */
  truncate?: boolean
  /** 剩余天数（订阅类型时使用） */
  daysRemaining?: number | null
  /**
   * 订阅分组默认在右侧 label 展示"订阅"或剩余天数；
   * 开启后订阅分组也改为显示倍率（保留订阅主题色 label，配合可用渠道这类
   * 只关心费率、不关心有效期的场景）。
   */
  alwaysShowRate?: boolean
}

/** 平台主题色映射到与 Arc badge 相同的语义色调 */
type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

function platformTone(platform?: GroupPlatform): Tone {
  switch (platform) {
    case 'anthropic':
      return 'warning'
    case 'openai':
      return 'success'
    case 'grok':
      return 'neutral'
    default:
      return 'info'
  }
}

/**
 * 分组徽章：平台 logo + 分组名 + 右侧倍率/订阅剩余天数 + 高峰倍率窗口。
 * 外观沿用 Arc badge 的色调变量；Arc Badge 的内容宽度固定为 max-content，无法截断长分组名，
 * 因此这里用同一套 token 自绘外壳。
 */
export default function GroupBadge({
  name,
  platform,
  subscriptionType = 'standard',
  rateMultiplier,
  userRateMultiplier = null,
  peakRateEnabled = false,
  peakStart,
  peakEnd,
  peakRateMultiplier,
  showRate = true,
  truncate = true,
  daysRemaining = null,
  alwaysShowRate = false,
  className,
  ...rest
}: GroupBadgeProps) {
  const { t } = useI18n()
  const serverUtcOffset = useAppStore((state) => state.cachedPublicSettings?.server_utc_offset)

  const isSubscription = subscriptionType === 'subscription'

  // 是否有专属倍率（且与默认倍率不同）
  const hasCustomRate =
    userRateMultiplier !== null &&
    userRateMultiplier !== undefined &&
    rateMultiplier !== undefined &&
    userRateMultiplier !== rateMultiplier

  const hasPeakRate = Boolean(showRate && peakRateEnabled && peakStart && peakEnd)
  const peakRateText = hasPeakRate
    ? formatPeakRateWindow(
        {
          peak_rate_enabled: peakRateEnabled,
          peak_start: peakStart,
          peak_end: peakEnd,
          peak_rate_multiplier: peakRateMultiplier
        },
        serverTimezoneLabel(serverUtcOffset)
      )
    : ''

  // 是否显示右侧标签：订阅类型显示天数或"订阅"；标准类型显示倍率（包括专属倍率）
  const showLabel = showRate && (isSubscription || rateMultiplier !== undefined || hasCustomRate)

  const labelText = (() => {
    const rateLabel = rateMultiplier !== undefined ? `${rateMultiplier}x` : ''
    if (isSubscription && !alwaysShowRate) {
      // 如果有剩余天数，显示天数
      if (daysRemaining !== null && daysRemaining !== undefined) {
        if (daysRemaining <= 0) return t('admin.users.expired')
        return t('admin.users.daysRemaining', { days: daysRemaining })
      }
      // 否则显示"订阅"
      return t('groups.subscription')
    }
    return rateLabel
  })()

  // 订阅类型根据剩余天数提示：已过期或 <=3 天红色，<=7 天橙色，其余跟随平台主题色
  const labelTone = (() => {
    if (!isSubscription) return 'muted'
    if (daysRemaining !== null && daysRemaining !== undefined) {
      if (daysRemaining <= 3) return 'danger'
      if (daysRemaining <= 7) return 'warning'
    }
    return 'theme'
  })()

  return (
    <span
      {...rest}
      data-tone={platformTone(platform)}
      data-platform={platform}
      data-subscription={isSubscription ? '' : undefined}
      className={[styles.badge, className].filter(Boolean).join(' ')}
    >
      {platform && <PlatformIcon platform={platform} size="sm" />}
      <span className={truncate ? styles.nameTruncate : styles.nameWrap}>{name}</span>
      {showLabel && (
        <span className={styles.label} data-tone={labelTone}>
          {hasCustomRate ? (
            <>
              {/* 原倍率删除线 + 专属倍率高亮 */}
              <span className={styles.strike}>{rateMultiplier}x</span>
              <span className={styles.customRate}>{userRateMultiplier}x</span>
            </>
          ) : (
            labelText
          )}
        </span>
      )}
      {hasPeakRate && (
        <span className={styles.peak} title={t('common.peakRateTooltip', { window: peakRateText })}>
          {peakRateText}
        </span>
      )}
    </span>
  )
}
