import { CreditCard } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import subscriptionsAPI from '@/api/subscriptions'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import EmptyState from '@/components/common/EmptyState'
import PlatformIcon from '@/components/common/PlatformIcon'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { GroupPlatform, UserSubscription } from '@/types'
import { formatDateTimeToMinute } from '@/utils/format'
import { formatPeakRateWindow, hasPeakRate, serverTimezoneLabel } from '@/utils/peak-rate'
import { platformLabel } from '@/utils/platformColors'
import {
  getExpirationDateRelation,
  getRemainingDurationParts,
  isOneTimeDailyQuota,
  type RemainingDurationParts
} from '@/utils/subscriptionQuota'
import styles from './SubscriptionsView.module.css'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'
type QuotaWindow = 'daily' | 'weekly' | 'monthly'

function statusTone(status: UserSubscription['status']): BadgeTone {
  if (status === 'active') return 'success'
  if (status === 'expired') return 'neutral'
  return 'danger'
}

function getProgressWidth(used: number | undefined, limit: number | null | undefined): string {
  if (!limit || limit === 0) return '0%'
  const percentage = Math.min(((used || 0) / limit) * 100, 100)
  return `${percentage}%`
}

/** 进度条色调：未配置限额灰，≥90 红、≥70 橙（警告）、其余绿 */
function getProgressTone(used: number | undefined, limit: number | null | undefined): Tone {
  if (!limit || limit === 0) return 'neutral'
  const percentage = ((used || 0) / limit) * 100
  if (percentage >= 90) return 'danger'
  if (percentage >= 70) return 'warning'
  return 'success'
}

/** 到期文字色调：已过期或 3 天内红、7 天内橙、其余默认 */
function getExpirationTone(expiresAt: string): Tone {
  const now = new Date()
  const expires = new Date(expiresAt)
  const diff = expires.getTime() - now.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))

  if (diff <= 0) return 'danger'
  if (days <= 3) return 'danger'
  if (days <= 7) return 'warning'
  return 'neutral'
}

function formatDurationParts(parts: RemainingDurationParts): string {
  if (parts.days > 0) {
    return `${parts.days}d ${parts.hours}h`
  }

  if (parts.hours > 0) {
    return `${parts.hours}h ${parts.minutes}m`
  }

  return `${parts.minutes}m`
}

/** 用户订阅列表：每个订阅的状态、到期时间与日/周/月用量 */
export default function SubscriptionsView() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const serverUtcOffset = useAppStore((s) => s.cachedPublicSettings?.server_utc_offset)

  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([])
  const [loading, setLoading] = useState(true)

  const loadSubscriptions = async () => {
    try {
      setLoading(true)
      setSubscriptions(await subscriptionsAPI.getMySubscriptions())
    } catch (error) {
      console.error('Failed to load subscriptions:', error)
      useAppStore.getState().showError(t('userSubscriptions.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }

  useMountOnce(() => {
    void loadSubscriptions()
  })

  const formatExpirationDate = (expiresAt: string): string => {
    const now = new Date()
    const expires = new Date(expiresAt)
    const diff = expires.getTime() - now.getTime()
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    const relation = getExpirationDateRelation(expires, now)

    if (relation === null) return ''

    if (relation === 'expired') {
      return t('userSubscriptions.status.expired')
    }

    const dateStr = formatDateTimeToMinute(expires)

    if (relation === 'today') {
      return `${dateStr} (${t('common.today')})`
    }
    if (relation === 'tomorrow') {
      return `${dateStr} (${t('common.tomorrow')})`
    }

    return t('userSubscriptions.daysRemaining', { days }) + ` (${dateStr})`
  }

  const formatResetTime = (windowStart: string | null, windowHours: number): string => {
    if (!windowStart) return t('userSubscriptions.windowNotActive')

    const start = new Date(windowStart)
    const end = new Date(start.getTime() + windowHours * 60 * 60 * 1000)
    const parts = getRemainingDurationParts(end)

    return parts ? formatDurationParts(parts) : t('userSubscriptions.windowNotActive')
  }

  const formatDailyUsageWindow = (subscription: UserSubscription): string => {
    if (isOneTimeDailyQuota(subscription) && subscription.expires_at) {
      const parts = getRemainingDurationParts(subscription.expires_at)
      if (!parts) return t('userSubscriptions.windowNotActive')
      return t('userSubscriptions.quotaEndsIn', { time: formatDurationParts(parts) })
    }

    return t('userSubscriptions.resetIn', {
      time: formatResetTime(subscription.daily_window_start, 24)
    })
  }

  const renderUsage = (subscription: UserSubscription, window: QuotaWindow) => {
    const limit = subscription.group?.[`${window}_limit_usd`]
    if (!limit) return null
    const used = subscription[`${window}_usage_usd`]
    const windowStart = subscription[`${window}_window_start`]
    let resetText = ''
    if (windowStart) {
      if (window === 'daily') resetText = formatDailyUsageWindow(subscription)
      else resetText = t('userSubscriptions.resetIn', { time: formatResetTime(windowStart, window === 'weekly' ? 168 : 720) })
    }
    return (
      <div className={styles.usage}>
        <div className={styles.usageLine}>
          <span className={styles.usageLabel}>{t(`userSubscriptions.${window}`)}</span>
          <span className={styles.usageValue}>
            ${(used || 0).toFixed(2)} / ${limit.toFixed(2)}
          </span>
        </div>
        <div className={styles.meter} data-tone={getProgressTone(used, limit)} aria-hidden="true">
          <span className={styles.meterFill} style={{ width: getProgressWidth(used, limit) }} />
        </div>
        {resetText ? <p className={styles.usageReset}>{resetText}</p> : null}
      </div>
    )
  }

  if (loading) {
    return (
      <div className={styles.grid} aria-busy="true">
        {[0, 1].map((index) => (
          <Skeleton key={index} lines={5} className={styles.skeleton} label={t('common.loading')} />
        ))}
      </div>
    )
  }

  if (subscriptions.length === 0) {
    return (
      <div className={styles.empty}>
        <EmptyState
          icon={CreditCard}
          title={t('userSubscriptions.noActiveSubscriptions')}
          description={t('userSubscriptions.noActiveSubscriptionsDesc')}
        />
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {subscriptions.map((subscription) => {
        const platform = subscription.group?.platform || ''
        const group = subscription.group
        const unlimited = !group?.daily_limit_usd && !group?.weekly_limit_usd && !group?.monthly_limit_usd
        return (
          <section key={subscription.id} className={styles.card} aria-labelledby={`subscription-${subscription.id}`}>
            {/* Header */}
            <div className={styles.header}>
              <div className={styles.headerMain}>
                <div className={styles.titleRow}>
                  <h2 id={`subscription-${subscription.id}`} className={styles.title}>
                    {group?.name || `Group #${subscription.group_id}`}
                  </h2>
                  <Badge size="sm" icon={platform ? <PlatformIcon platform={platform as GroupPlatform} size="xs" /> : undefined}>
                    {platformLabel(platform)}
                  </Badge>
                </div>
                {group?.description ? <p className={styles.description}>{group.description}</p> : null}
                <div className={styles.rates}>
                  <span>
                    {t('payment.planCard.rate')}: ×{group?.rate_multiplier ?? 1}
                  </span>
                  {hasPeakRate(group) && (
                    <span className={styles.peak}>
                      {t('payment.planCard.peakRate')}: {formatPeakRateWindow(group, serverTimezoneLabel(serverUtcOffset))}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.headerActions}>
                <Badge size="sm" tone={statusTone(subscription.status)}>
                  {t(`userSubscriptions.status.${subscription.status}`)}
                </Badge>
                {subscription.status === 'active' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      void navigate({
                        pathname: '/purchase',
                        search: `?${new URLSearchParams({ tab: 'subscription', group: String(subscription.group_id) }).toString()}`
                      })
                    }
                  >
                    {t('payment.renewNow')}
                  </Button>
                )}
              </div>
            </div>

            {/* Usage Progress */}
            <div className={styles.body}>
              {/* Expiration Info */}
              <div className={styles.expires}>
                <span className={styles.expiresLabel}>{t('userSubscriptions.expires')}</span>
                {subscription.expires_at ? (
                  <span className={styles.expiresValue} data-tone={getExpirationTone(subscription.expires_at)}>
                    {formatExpirationDate(subscription.expires_at)}
                  </span>
                ) : (
                  <span className={styles.expiresValue}>{t('userSubscriptions.noExpiration')}</span>
                )}
              </div>

              {renderUsage(subscription, 'daily')}
              {renderUsage(subscription, 'weekly')}
              {renderUsage(subscription, 'monthly')}

              {/* No limits configured - Unlimited badge */}
              {unlimited && (
                <div className={styles.unlimited}>
                  <span className={styles.infinity} aria-hidden="true">
                    ∞
                  </span>
                  <div>
                    <p className={styles.unlimitedTitle}>{t('userSubscriptions.unlimited')}</p>
                    <p className={styles.unlimitedDesc}>{t('userSubscriptions.unlimitedDesc')}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
