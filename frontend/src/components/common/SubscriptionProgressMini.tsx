/**
 * 顶栏订阅进度：按钮显示活跃订阅数与用量状态点，点击后用 Arc Popover 展示每个订阅的日/周/月用量。
 */
import { useEffect, useMemo, useState } from 'react'
import { CreditCard, Infinity as InfinityIcon } from 'lucide-react'
import { Link } from 'react-router'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { Progress } from '@/components/arc/progress/progress'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useSubscriptionStore } from '@/stores/subscriptions'
import type { UserSubscription } from '@/types'
import { FeatureFlags, isFeatureFlagEnabled, resolveFeatureFlag } from '@/utils/featureFlags'
import { getExpirationDateRelation } from '@/utils/subscriptionQuota'
import styles from './SubscriptionProgressMini.module.css'

type UsageLevel = 'unlimited' | 'danger' | 'warning' | 'ok'

function getMaxUsagePercentage(sub: UserSubscription): number {
  const percentages: number[] = []
  if (sub.group?.daily_limit_usd) {
    percentages.push(((sub.daily_usage_usd || 0) / sub.group.daily_limit_usd) * 100)
  }
  if (sub.group?.weekly_limit_usd) {
    percentages.push(((sub.weekly_usage_usd || 0) / sub.group.weekly_limit_usd) * 100)
  }
  if (sub.group?.monthly_limit_usd) {
    percentages.push(((sub.monthly_usage_usd || 0) / sub.group.monthly_limit_usd) * 100)
  }
  return percentages.length > 0 ? Math.max(...percentages) : 0
}

function isUnlimited(sub: UserSubscription): boolean {
  return (
    !sub.group?.daily_limit_usd &&
    !sub.group?.weekly_limit_usd &&
    !sub.group?.monthly_limit_usd
  )
}

function getProgressDotLevel(sub: UserSubscription): UsageLevel {
  // Unlimited subscriptions get a special color
  if (isUnlimited(sub)) return 'unlimited'
  const maxPercentage = getMaxUsagePercentage(sub)
  if (maxPercentage >= 90) return 'danger'
  if (maxPercentage >= 70) return 'warning'
  return 'ok'
}

function formatUsage(used: number | undefined, limit: number | null | undefined): string {
  const usedValue = (used || 0).toFixed(2)
  const limitValue = limit?.toFixed(2) || '∞'
  return `$${usedValue}/$${limitValue}`
}

function getDaysRemainingLevel(expiresAt: string): 'danger' | 'warning' | 'normal' {
  const now = new Date()
  const expires = new Date(expiresAt)
  const diff = expires.getTime() - now.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days <= 3) return 'danger'
  if (days <= 7) return 'warning'
  return 'normal'
}

interface UsageRowProps {
  label: string
  used: number | undefined
  limit: number | null | undefined
}

function UsageRow({ label, used, limit }: UsageRowProps) {
  return (
    <div className={styles.usageRow}>
      <Progress label={label} value={used || 0} max={limit || 0} showValue />
      <span className={styles.usageText}>{formatUsage(used, limit)}</span>
    </div>
  )
}

export default function SubscriptionProgressMini() {
  const { t } = useI18n()
  const activeSubscriptions = useSubscriptionStore((state) => state.activeSubscriptions)
  const hasActiveSubscriptions = useSubscriptionStore((state) => state.hasActiveSubscriptions)
  const settings = useAppStore((state) => state.cachedPublicSettings)
  // 订阅功能关闭后，即使用户仍持有后台分配的订阅，顶栏也不再露出订阅进度与「查看全部订阅」入口。
  const subscriptionFeatureEnabled = resolveFeatureFlag(settings, FeatureFlags.subscription)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  const displaySubscriptions = useMemo(
    // Sort by most usage (highest percentage first)
    () => [...activeSubscriptions].sort((a, b) => getMaxUsagePercentage(b) - getMaxUsagePercentage(a)),
    [activeSubscriptions],
  )

  useEffect(() => {
    // Trigger initial fetch if not already loaded
    // The actual data loading is handled by RootLayout globally
    if (!isFeatureFlagEnabled(FeatureFlags.subscription)) return
    useSubscriptionStore.getState().fetchActiveSubscriptions().catch((error: unknown) => {
      console.error('Failed to load subscriptions in SubscriptionProgressMini:', error)
    })
  }, [])

  function formatDaysRemaining(expiresAt: string): string {
    const now = new Date()
    const expires = new Date(expiresAt)
    const diff = expires.getTime() - now.getTime()
    const relation = getExpirationDateRelation(expires, now)
    if (relation === 'expired') return t('subscriptionProgress.expired')
    if (relation === 'today') return t('subscriptionProgress.expiresToday')
    if (relation === 'tomorrow') return t('subscriptionProgress.expiresTomorrow')
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    return t('subscriptionProgress.daysRemaining', { days })
  }

  if (!subscriptionFeatureEnabled || !hasActiveSubscriptions) {
    return null
  }

  return (
    <Popover open={tooltipOpen} onOpenChange={setTooltipOpen}>
      <PopoverTrigger className={styles.trigger} title={t('subscriptionProgress.viewDetails')}>
        <CreditCard size={16} strokeWidth={1.75} aria-hidden="true" />
        {/* Combined progress indicator */}
        <span className={styles.dots} aria-hidden="true">
          {displaySubscriptions.slice(0, 3).map((sub) => (
            <span key={sub.id} className={styles.dot} data-level={getProgressDotLevel(sub)} />
          ))}
        </span>
        <span className={styles.total}>{activeSubscriptions.length}</span>
      </PopoverTrigger>

      <PopoverContent align="end" className={styles.panel} aria-label={t('subscriptionProgress.title')}>
        <div className={styles.header}>
          <h3 className={styles.heading}>{t('subscriptionProgress.title')}</h3>
          <p className={styles.subheading}>
            {t('subscriptionProgress.activeCount', { count: activeSubscriptions.length })}
          </p>
        </div>

        <div className={styles.list}>
          {displaySubscriptions.map((subscription) => (
            <div key={subscription.id} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.groupName}>
                  {subscription.group?.name || `Group #${subscription.group_id}`}
                </span>
                {subscription.expires_at && (
                  <span className={styles.expires} data-level={getDaysRemainingLevel(subscription.expires_at)}>
                    {formatDaysRemaining(subscription.expires_at)}
                  </span>
                )}
              </div>

              {/* Progress bars or Unlimited badge */}
              {isUnlimited(subscription) ? (
                <div className={styles.unlimited}>
                  <InfinityIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>{t('subscriptionProgress.unlimited')}</span>
                </div>
              ) : (
                <div className={styles.usage}>
                  {!!subscription.group?.daily_limit_usd && (
                    <UsageRow
                      label={t('subscriptionProgress.daily')}
                      used={subscription.daily_usage_usd}
                      limit={subscription.group.daily_limit_usd}
                    />
                  )}
                  {!!subscription.group?.weekly_limit_usd && (
                    <UsageRow
                      label={t('subscriptionProgress.weekly')}
                      used={subscription.weekly_usage_usd}
                      limit={subscription.group.weekly_limit_usd}
                    />
                  )}
                  {!!subscription.group?.monthly_limit_usd && (
                    <UsageRow
                      label={t('subscriptionProgress.monthly')}
                      used={subscription.monthly_usage_usd}
                      limit={subscription.group.monthly_limit_usd}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <Link to="/subscriptions" className={styles.viewAll} onClick={() => setTooltipOpen(false)}>
            {t('subscriptionProgress.viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
