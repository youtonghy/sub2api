/**
 * 上游计费倍率单元格，对应 Vue 版 UpstreamBillingRateCell.vue。
 * 仅 API Key 账号可探测；显示按当前时间（含高峰时段）重新计算的有效倍率，
 * 快照过期或失败时显示状态文案，悬停查看详情，图标按钮触发手动探测。
 */
import { RefreshCw } from 'lucide-react'

import HelpTooltip from '@/components/common/HelpTooltip'
import { useI18n } from '@/i18n/useI18n'
import type { Account, UpstreamBillingProbeSnapshot } from '@/types'
import { formatMultiplier } from '@/utils/formatters'
import styles from './UpstreamBillingRateCell.module.css'

export interface UpstreamBillingRateCellProps {
  account: Account
  now: number
  probing?: boolean
  /** 默认 true */
  globalProbeEnabled?: boolean
  onProbe?: () => void
}

const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000

const parseMinute = (value?: string) => {
  if (typeof value !== 'string') return null
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour < 24 && minute < 60 ? hour * 60 + minute : null
}

const minuteInTimeZone = (timestamp: number, timeZone?: string) => {
  if (!timeZone) return null
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(timestamp))
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value)
    return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null
  } catch {
    return null
  }
}

const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '-'

type StatusTone = 'muted' | 'secondary' | 'warning' | 'danger' | ''

export default function UpstreamBillingRateCell({
  account,
  now,
  probing = false,
  globalProbeEnabled = true,
  onProbe
}: UpstreamBillingRateCellProps) {
  const { t } = useI18n()

  // 探测资格已放宽到全部 API-key 平台（上游是 sub2api 即可应答）。
  const eligible = account.type === 'apikey'
  if (!eligible) return <span className={styles.empty}>-</span>

  const snapshot: UpstreamBillingProbeSnapshot | undefined = account.extra?.upstream_billing_probe
  const data = snapshot?.data
  const probeEnabled = account.extra?.upstream_billing_probe_enabled === true
  const nextProbeAtRaw = snapshot?.next_probe_at
  const nextProbeAt =
    typeof nextProbeAtRaw === 'string' && Number.isFinite(Date.parse(nextProbeAtRaw)) ? nextProbeAtRaw : ''

  const receivedAt = typeof snapshot?.received_at === 'string' ? Date.parse(snapshot.received_at) : Number.NaN
  const freshUntil = (() => {
    if (typeof snapshot?.fresh_until === 'string') return Date.parse(snapshot.fresh_until)
    if (snapshot?.status !== 'ok' || typeof snapshot.next_probe_at !== 'string') return Number.NaN
    const next = Date.parse(snapshot.next_probe_at)
    return Number.isFinite(next) && next > receivedAt ? receivedAt + 2 * (next - receivedAt) : Number.NaN
  })()
  const validTimestamps = (() => {
    if (!Number.isFinite(receivedAt) || receivedAt > now + CLOCK_SKEW_TOLERANCE_MS) return false
    return Number.isFinite(freshUntil) && freshUntil > receivedAt
  })()
  const stale = (() => {
    if (!snapshot) return false
    if (!Number.isFinite(receivedAt)) return snapshot.status === 'ok'
    if (!validTimestamps) return true
    return now > freshUntil
  })()

  const currentEffectiveRate = (() => {
    const billing = data
    if (!billing) return null
    if (billing.billing_scope !== 'token') return null
    const base = billing.resolved_rate_multiplier
    if (typeof base !== 'number' || !Number.isFinite(base) || base < 0) return null
    if (typeof billing.peak_rate_enabled !== 'boolean') return null
    if (!billing.peak_rate_enabled) return base
    const start = parseMinute(billing.peak_start)
    const end = parseMinute(billing.peak_end)
    const minute = minuteInTimeZone(now, billing.timezone)
    const peak = billing.peak_rate_multiplier
    if (
      start == null ||
      end == null ||
      minute == null ||
      start >= end ||
      typeof peak !== 'number' ||
      !Number.isFinite(peak) ||
      peak < 0
    )
      return null
    const value = minute >= start && minute < end ? base * peak : base
    return Number.isFinite(value) ? value : null
  })()

  const lastDetectedRate = (() => {
    const value = data?.effective_rate_multiplier
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Number(value.toPrecision(12)) : null
  })()

  const elapsedSinceLastSuccess = (() => {
    if (!Number.isFinite(receivedAt)) return '-'
    const elapsedMinutes = Math.max(0, Math.floor((now - receivedAt) / 60_000))
    if (elapsedMinutes < 1) return t('admin.accounts.upstreamBilling.justNow')
    if (elapsedMinutes < 60) return t('admin.accounts.upstreamBilling.minutesAgo', { count: elapsedMinutes })
    const elapsedHours = Math.floor(elapsedMinutes / 60)
    if (elapsedHours < 24) return t('admin.accounts.upstreamBilling.hoursAgo', { count: elapsedHours })
    return t('admin.accounts.upstreamBilling.daysAgo', { count: Math.floor(elapsedHours / 24) })
  })()

  const effectiveRate = (() => {
    if (!validTimestamps || stale || !['ok', 'failed'].includes(snapshot?.status ?? '')) return '-'
    return currentEffectiveRate == null ? '-' : `${formatMultiplier(currentEffectiveRate)}x`
  })()

  let statusLabel = ''
  let statusTone: StatusTone = ''
  if (!snapshot) {
    statusLabel = t('admin.accounts.upstreamBilling.notProbed')
    statusTone = 'muted'
  } else if (snapshot.status === 'unsupported') {
    statusLabel = t('admin.accounts.upstreamBilling.unsupported')
    statusTone = 'secondary'
  } else if (stale) {
    statusLabel = t('admin.accounts.upstreamBilling.stale')
    statusTone = 'warning'
  } else if (snapshot.status === 'failed') {
    statusLabel = t('admin.accounts.upstreamBilling.failed')
    statusTone = 'danger'
  }

  const hasEffectiveRate = effectiveRate !== '-'
  const primaryValue = hasEffectiveRate ? effectiveRate : statusLabel || '-'
  const primaryTone = hasEffectiveRate ? '' : statusTone || 'muted'

  return (
    <div className={styles.cell}>
      <span data-testid="upstream-billing-details" className={styles.details}>
        <HelpTooltip
          width="max-content"
          className={styles.tooltipTrigger}
          triggerContent={
            <span
              className={`${styles.primary} ${hasEffectiveRate ? styles.rate : ''}`}
              data-tone={primaryTone || undefined}
              data-testid="upstream-billing-rate"
            >
              {primaryValue}
            </span>
          }
        >
          <div className={styles.tooltipBody}>
            {hasEffectiveRate && data ? (
              <>
                <p>{t('admin.accounts.upstreamBilling.groupRate', { value: data.group_rate_multiplier })}</p>
                {data.user_rate_multiplier != null ? (
                  <p>{t('admin.accounts.upstreamBilling.userRate', { value: data.user_rate_multiplier })}</p>
                ) : null}
                <p>
                  {data.peak_rate_enabled
                    ? t('admin.accounts.upstreamBilling.peakRate', {
                        start: data.peak_start,
                        end: data.peak_end,
                        value: data.peak_rate_multiplier,
                        timezone: data.timezone
                      })
                    : t('admin.accounts.upstreamBilling.noPeakRate')}
                </p>
                <p>{t('admin.accounts.upstreamBilling.effectiveRate', { value: currentEffectiveRate ?? '-' })}</p>
                <p>{t('admin.accounts.upstreamBilling.updatedAt', { value: formatDate(snapshot?.received_at) })}</p>
              </>
            ) : stale && lastDetectedRate != null ? (
              <>
                <p data-testid="upstream-billing-last-rate">
                  {t('admin.accounts.upstreamBilling.lastDetectedRate', { value: lastDetectedRate })}
                </p>
                <p data-testid="upstream-billing-last-time">
                  {t('admin.accounts.upstreamBilling.lastDetectedAt', { value: formatDate(snapshot?.received_at) })}
                </p>
                <p data-testid="upstream-billing-elapsed">
                  {t('admin.accounts.upstreamBilling.elapsedSince', { value: elapsedSinceLastSuccess })}
                </p>
              </>
            ) : (
              <p>{statusLabel || '-'}</p>
            )}
            {probeEnabled && globalProbeEnabled !== false && nextProbeAt ? (
              <p data-testid="upstream-billing-next-probe">
                {t('admin.accounts.upstreamBilling.nextProbeAt', { value: formatDate(nextProbeAt) })}
              </p>
            ) : null}
            <p className={styles.probeState} data-testid="upstream-billing-probe-state">
              {t('admin.accounts.upstreamBilling.accountProbeState')}{' '}
              <span data-state={probeEnabled ? 'enabled' : 'disabled'}>
                {probeEnabled ? t('admin.accounts.upstreamBilling.enabled') : t('admin.accounts.upstreamBilling.disabled')}
              </span>
            </p>
            {globalProbeEnabled === false ? (
              <p className={styles.globalState} data-testid="upstream-billing-global-probe-state">
                {t('admin.accounts.upstreamBilling.globalProbeState')}{' '}
                <span data-state="disabled">{t('admin.accounts.upstreamBilling.disabled')}</span>
              </p>
            ) : null}
          </div>
        </HelpTooltip>
      </span>
      {hasEffectiveRate && statusLabel ? (
        <span className={styles.status} data-tone={statusTone || undefined}>
          {statusLabel}
        </span>
      ) : null}
      <button
        type="button"
        className={styles.probe}
        disabled={probing}
        aria-label={t('admin.accounts.upstreamBilling.manualProbe')}
        title={t('admin.accounts.upstreamBilling.manualProbe')}
        data-testid="upstream-billing-probe"
        onClick={() => onProbe?.()}
      >
        <RefreshCw aria-hidden="true" className={probing ? styles.spinning : undefined} />
      </button>
    </div>
  )
}
