import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { UserSubscription } from '@/types'
import type { SubscriptionPlan } from '@/types/payment'
import { hasPeakRate as groupHasPeakRate, formatPeakRateWindow, serverTimezoneLabel } from '@/utils/peak-rate'
import { platformAccentColor, platformLabel } from '@/utils/platformColors'
import { currencySymbol } from './currency'
import { planValiditySuffix } from './validity'
import styles from './SubscriptionPlanCard.module.css'

export interface SubscriptionPlanCardProps {
  plan: SubscriptionPlan
  activeSubscriptions?: UserSubscription[]
  onSelect?: (plan: SubscriptionPlan) => void
}

const MODEL_SCOPE_LABELS: Record<string, string> = {
  claude: 'Claude',
  gemini_text: 'Gemini',
  gemini_image: 'Imagen',
}

export default function SubscriptionPlanCard({ plan, activeSubscriptions, onSelect }: SubscriptionPlanCardProps) {
  const { t } = useI18n()
  const serverUtcOffset = useAppStore((s) => s.cachedPublicSettings?.server_utc_offset)

  const platform = plan.group_platform || ''
  const isRenewal = activeSubscriptions?.some((s) => s.group_id === plan.group_id && s.status === 'active') ?? false

  let discountText = ''
  if (plan.original_price && plan.original_price > 0) {
    const pct = Math.round((1 - plan.price / plan.original_price) * 100)
    discountText = pct > 0 ? `-${pct}%` : ''
  }

  const rateDisplay = `×${Number((plan.rate_multiplier ?? 1).toPrecision(10))}`
  const planCurrencySymbol = currencySymbol(plan.currency || 'USD')
  const hasPeakRate = groupHasPeakRate(plan)
  const peakRateDisplay = hasPeakRate ? formatPeakRateWindow(plan, serverTimezoneLabel(serverUtcOffset)) : ''

  const scopes = plan.supported_model_scopes
  const modelScopeLabels = platform === 'antigravity' && scopes && scopes.length > 0
    ? scopes.map((s) => MODEL_SCOPE_LABELS[s] || s)
    : []

  const validitySuffix = planValiditySuffix(plan, t)
  const noLimits = plan.daily_limit_usd == null && plan.weekly_limit_usd == null && plan.monthly_limit_usd == null
  // 平台强调色只用于卡片顶部细条，来自集中配置
  const accentStyle = { '--plan-accent': platformAccentColor(platform) } as CSSProperties

  return (
    <div className={styles.card} style={accentStyle} data-platform={platform}>
      <div className={styles.accentBar} aria-hidden="true" />

      <div className={styles.body}>
        {/* Header: name + badge + price */}
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <h3 title={plan.name} className={styles.title} data-testid="plan-title">
              {plan.name}
            </h3>
            {plan.description && <p className={styles.description}>{plan.description}</p>}
          </div>
          <div className={styles.priceBlock} data-testid="plan-price-block">
            <div className={styles.priceLine}>
              <span className={styles.currencySymbol}>{planCurrencySymbol}</span>
              <span className={styles.price} data-testid="plan-price">{plan.price}</span>
              {plan.currency && <span className={styles.currencyCode}>{plan.currency}</span>}
            </div>
            <div className={styles.validityLine} data-testid="plan-validity">
              <Badge size="sm" className={styles.platformBadge}>{platformLabel(platform)}</Badge>
              <span className={styles.validity}>/ {validitySuffix}</span>
            </div>
            {!!plan.original_price && (
              <div className={styles.originalLine}>
                <span className={styles.originalPrice}>
                  {planCurrencySymbol}{plan.original_price}{plan.currency || ''}
                </span>
                {discountText && <Badge tone="success" size="sm">{discountText}</Badge>}
              </div>
            )}
          </div>
        </div>

        {/* Group quota info (compact) */}
        <dl className={styles.quota}>
          <div className={styles.quotaRow}>
            <dt>{t('payment.planCard.rate')}</dt>
            <dd>{rateDisplay}</dd>
          </div>
          {hasPeakRate && (
            <div className={`${styles.quotaRow} ${styles.quotaWide}`}>
              <dt>{t('payment.planCard.peakRate')}</dt>
              <dd className={styles.peak}>{peakRateDisplay}</dd>
            </div>
          )}
          {plan.daily_limit_usd != null && (
            <div className={styles.quotaRow}>
              <dt>{t('payment.planCard.dailyLimit')}</dt>
              <dd>${plan.daily_limit_usd}</dd>
            </div>
          )}
          {plan.weekly_limit_usd != null && (
            <div className={styles.quotaRow}>
              <dt>{t('payment.planCard.weeklyLimit')}</dt>
              <dd>${plan.weekly_limit_usd}</dd>
            </div>
          )}
          {plan.monthly_limit_usd != null && (
            <div className={styles.quotaRow}>
              <dt>{t('payment.planCard.monthlyLimit')}</dt>
              <dd>${plan.monthly_limit_usd}</dd>
            </div>
          )}
          {noLimits && (
            <div className={styles.quotaRow}>
              <dt>{t('payment.planCard.quota')}</dt>
              <dd>{t('payment.planCard.unlimited')}</dd>
            </div>
          )}
          {modelScopeLabels.length > 0 && (
            <div className={`${styles.quotaRow} ${styles.quotaWide}`}>
              <dt>{t('payment.planCard.models')}</dt>
              <dd className={styles.scopes}>
                {modelScopeLabels.map((scope) => (
                  <Badge key={scope} size="sm">{scope}</Badge>
                ))}
              </dd>
            </div>
          )}
        </dl>

        {/* Features list (compact) */}
        {plan.features.length > 0 && (
          <ul className={styles.features}>
            {plan.features.map((feature) => (
              <li key={feature} className={styles.feature}>
                <Check size={14} className={styles.featureIcon} aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.spacer} />

        {/* Subscribe Button */}
        <Button type="button" className={styles.action} onClick={() => onSelect?.(plan)}>
          {isRenewal ? t('payment.renewNow') : t('payment.subscribeNow')}
        </Button>
      </div>
    </div>
  )
}
