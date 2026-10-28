import { Check } from 'lucide-react'

import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { GroupPlatform, SubscriptionType } from '@/types'
import { formatPeakRateWindow, serverTimezoneLabel } from '@/utils/peak-rate'
import GroupBadge from './GroupBadge'
import styles from './GroupOptionItem.module.css'

export interface GroupOptionItemProps {
  name: string
  platform: GroupPlatform
  subscriptionType?: SubscriptionType
  rateMultiplier?: number
  userRateMultiplier?: number | null
  peakRateEnabled?: boolean
  peakStart?: string
  peakEnd?: string
  peakRateMultiplier?: number
  description?: string | null
  selected?: boolean
  showCheckmark?: boolean
}

/** 下拉选项中的分组行：左侧徽章与描述，右侧倍率与选中标记 */
export default function GroupOptionItem({
  name,
  platform,
  subscriptionType = 'standard',
  rateMultiplier,
  userRateMultiplier = null,
  peakRateEnabled = false,
  peakStart,
  peakEnd,
  peakRateMultiplier,
  description,
  selected = false,
  showCheckmark = true
}: GroupOptionItemProps) {
  const { t } = useI18n()
  const serverUtcOffset = useAppStore((state) => state.cachedPublicSettings?.server_utc_offset)

  // Whether user has a custom rate different from default
  const hasCustomRate =
    userRateMultiplier !== null &&
    userRateMultiplier !== undefined &&
    rateMultiplier !== undefined &&
    userRateMultiplier !== rateMultiplier

  const hasPeakRate = Boolean(peakRateEnabled && peakStart && peakEnd)
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

  return (
    <div className={styles.root}>
      {/* Left: name + description */}
      <div className={styles.main} title={description || undefined}>
        {/* Row 1: platform badge */}
        <GroupBadge name={name} platform={platform} subscriptionType={subscriptionType} showRate={false} />
        {/* Row 2: description with top spacing */}
        {description && <span className={styles.description}>{description}</span>}
      </div>

      {/* Right: rate pill + checkmark (vertically centered to first row) */}
      <div className={styles.aside}>
        <div className={styles.pills}>
          {/* Rate pill (platform color) */}
          {rateMultiplier !== undefined && (
            <span className={styles.ratePill} data-platform={platform}>
              {hasCustomRate ? (
                <>
                  <span className={styles.strike}>{rateMultiplier}x</span>
                  <span>{userRateMultiplier}x</span>
                </>
              ) : (
                `${rateMultiplier}x ${t('admin.groups.rateLabel')}`
              )}
            </span>
          )}
          {hasPeakRate && (
            <span className={styles.peakPill} title={t('common.peakRateTooltip', { window: peakRateText })}>
              {peakRateText}
            </span>
          )}
        </div>
        {/* Checkmark */}
        {showCheckmark && selected && <Check className={styles.check} size={16} strokeWidth={1.75} aria-hidden="true" />}
      </div>
    </div>
  )
}
