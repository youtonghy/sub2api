/**
 * 模型广场的分组分节，对应 Vue 版 components/modelPlaza/PlazaGroupSection.vue。
 * 头部：分组徽章（名称/平台/倍率）+ 专属/订阅徽章 + 描述 + 高峰与长上下文说明；主体为模型价格表。
 */
import { Clock, Info, Shield } from 'lucide-react'
import type { CSSProperties } from 'react'

import { Badge } from '@/components/arc/badge/badge'
import type { ModelPlazaGroup } from '@/api/modelPlaza'
import GroupBadge from '@/components/common/GroupBadge'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { GroupPlatform, SubscriptionType } from '@/types'
import { formatPeakRateWindow, hasPeakRate, serverTimezoneLabel } from '@/utils/peak-rate'
import { platformAccentColor } from '@/utils/platformColors'
import PlazaModelPricingTable from './PlazaModelPricingTable'
import styles from './PlazaGroupSection.module.css'

export interface PlazaGroupSectionProps {
  group: ModelPlazaGroup
}

export default function PlazaGroupSection({ group }: PlazaGroupSectionProps) {
  const { t } = useI18n()
  const serverUtcOffset = useAppStore((state) => state.cachedPublicSettings?.server_utc_offset)

  /** 高峰窗口描述（含倍率与服务器时区标注）；分组未启用高峰为空串。 */
  const peakWindow = hasPeakRate(group) ? formatPeakRateWindow(group, serverTimezoneLabel(serverUtcOffset)) : ''

  const peakNote = peakWindow
    ? t('modelPlaza.detail.peakNote', { window: peakWindow, multiplier: group.peak_rate_multiplier })
    : ''

  /**
   * 分组关闭了长上下文阶梯、但组内有模型官方带阶梯时提示：实付列只展示基础档，
   * 官方阶梯仅供参考。字段缺失（旧后端）不提示。
   */
  const longContextNote = (() => {
    if (group.long_context_pricing_enabled !== false) return ''
    const hasOfficialLadder = group.models.some((m) => (m.official_pricing?.intervals?.length ?? 0) > 1)
    return hasOfficialLadder ? t('modelPlaza.detail.longContextDisabledNote') : ''
  })()

  return (
    <section
      className={styles.section}
      style={{ '--section-accent': platformAccentColor(group.platform) } as CSSProperties}
    >
      {/* 分组头部：名称/平台/倍率徽章/专属/订阅徽章 + 描述 */}
      <header className={styles.header}>
        <div className={styles.badges}>
          <GroupBadge
            name={group.name}
            platform={group.platform as GroupPlatform}
            subscriptionType={(group.subscription_type || 'standard') as SubscriptionType}
            rateMultiplier={group.rate_multiplier}
            userRateMultiplier={group.user_rate_multiplier ?? null}
            peakRateEnabled={group.peak_rate_enabled}
            peakStart={group.peak_start}
            peakEnd={group.peak_end}
            peakRateMultiplier={group.peak_rate_multiplier}
            alwaysShowRate
          />
          {group.is_exclusive && (
            <Badge tone="info" size="sm" icon={<Shield size={12} strokeWidth={2} />}>
              {t('modelPlaza.badges.exclusive')}
            </Badge>
          )}
          {group.subscription_type === 'subscription' && (
            <Badge tone="info" size="sm">
              {t('modelPlaza.badges.subscription')}
            </Badge>
          )}
        </div>
        {group.description && <p className={styles.description}>{group.description}</p>}
        {peakNote && (
          <p className={styles.peakNote}>
            <Clock size={12} strokeWidth={2} aria-hidden="true" />
            {peakNote}
          </p>
        )}
        {longContextNote && (
          <p className={styles.note}>
            <Info size={12} strokeWidth={2} aria-hidden="true" />
            {longContextNote}
          </p>
        )}
      </header>

      {/* 模型价格表：整行（含 hover 底色/分区底色）顶到卡片边缘，左右留白由表格首列/末列的 padding 提供 */}
      <div>
        {group.models.length > 0 ? (
          <PlazaModelPricingTable
            models={group.models}
            platform={group.platform}
            rateMultiplier={group.rate_multiplier}
            userRateMultiplier={group.user_rate_multiplier ?? null}
            imageRateIndependent={group.image_rate_independent}
            imageRateMultiplier={group.image_rate_multiplier}
            videoRateIndependent={group.video_rate_independent}
            videoRateMultiplier={group.video_rate_multiplier}
            peakWindow={peakWindow}
            peakRateMultiplier={group.peak_rate_multiplier}
          />
        ) : (
          <p className={styles.empty}>{t('modelPlaza.detail.noModels')}</p>
        )}
      </div>
    </section>
  )
}
