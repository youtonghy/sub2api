/**
 * 用量窗口进度条，对应 Vue 版 UsageProgressBar.vue。
 * 账号页所有用量/额度条共用这一个实现：沿用 Arc progress 的语义（role=progressbar + aria 值），
 * 填充色按阈值取 --success / --warning / --danger（默认 ≥90 危险、≥75 警告；剩余容量模式 ≤20 危险、≤50 警告）。
 */
import { useEffect, useState } from 'react'

import { useI18n } from '@/i18n/useI18n'
import type { WindowStats } from '@/types'
import { formatCompactNumber } from '@/utils/format'
import styles from './UsageProgressBar.module.css'

export type UsageProgressBarColor = 'indigo' | 'emerald' | 'purple' | 'amber'
export type UsageProgressBarLevel = 'success' | 'warning' | 'danger'

export interface UsageProgressBarProps {
  label: string
  /** Percentage (0-100+) */
  utilization: number
  resetsAt?: string | null
  color: UsageProgressBarColor
  windowStats?: WindowStats | null
  estimatedTotalCost?: number | null
  showNowWhenIdle?: boolean
  remainingCapacity?: boolean
  /** fixed: 定宽居中徽章（账号页纵向对齐）；auto: 限宽截断左对齐（监控页组合标签） */
  labelWidth?: 'fixed' | 'auto'
  /** Vue 版透传到根节点的属性 */
  title?: string
  className?: string
  'data-testid'?: string
  'data-test'?: string
}

/** 进度条配色等级，阈值与 Vue 版一致 */
function usageBarLevel(utilization: number, remainingCapacity = false): UsageProgressBarLevel {
  if (remainingCapacity) {
    if (utilization <= 20) return 'danger'
    if (utilization <= 50) return 'warning'
    return 'success'
  }
  if (utilization >= 90) return 'danger'
  if (utilization >= 75) return 'warning'
  return 'success'
}

// Reactive clock for countdown — only runs when a reset time is shown,
// to avoid creating many idle timers across large account lists.
function useResetClock(resetsAt: string | null | undefined): Date {
  const [now, setNow] = useState(() => new Date())
  // resetsAt 变为新值时立即校准时钟（Vue 版 watch(resetsAt)）
  const [prevResetsAt, setPrevResetsAt] = useState(resetsAt)
  if (prevResetsAt !== resetsAt) {
    setPrevResetsAt(resetsAt)
    if (resetsAt) setNow(new Date())
  }
  const active = Boolean(resetsAt)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    // 后台标签页会节流定时器，回到前台时立即刷新倒计时
    const refreshClockWhenVisible = () => {
      if (!document.hidden) setNow(new Date())
    }
    document.addEventListener('visibilitychange', refreshClockWhenVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshClockWhenVisible)
    }
  }, [active])
  return now
}

export default function UsageProgressBar({
  label,
  utilization,
  resetsAt,
  color,
  windowStats,
  estimatedTotalCost,
  showNowWhenIdle,
  remainingCapacity,
  labelWidth = 'fixed',
  title,
  className,
  'data-testid': dataTestId,
  'data-test': dataTest
}: UsageProgressBarProps) {
  const { t } = useI18n()
  const now = useResetClock(resetsAt)

  const level = usageBarLevel(utilization, remainingCapacity)

  // Bar width (capped at 100%)
  const barWidth = `${Math.min(Math.max(utilization, 0), 100)}%`

  // Display percentage (cap at 999% for readability)
  const percent = Math.round(remainingCapacity ? Math.min(Math.max(utilization, 0), 100) : utilization)
  const displayPercent = percent > 999 ? '>999%' : `${percent}%`

  const shouldShowResetTime = resetsAt ? true : Boolean(showNowWhenIdle && utilization <= 0)

  const formatResetTime = (() => {
    if (!resetsAt) {
      // Idle rolling window without a known reset time: treat as immediately available.
      return showNowWhenIdle && utilization <= 0 ? t('usage.resetNow') : '-'
    }

    const date = new Date(resetsAt)
    const diffMs = date.getTime() - now.getTime()

    // resetsAt 已过期：utilization>0 说明后端窗口数据还没刷新（active poll 没回写），
    // 显示「待刷新」以区别于真正可用的「现在」。
    if (diffMs <= 0) {
      return utilization > 0 ? t('usage.resetPending') : t('usage.resetNow')
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

    if (diffHours >= 24) {
      const days = Math.floor(diffHours / 24)
      return `${days}d ${diffHours % 24}h`
    } else if (diffHours > 0) {
      return `${diffHours}h ${diffMins}m`
    }
    return `${diffMins}m`
  })()

  const showStats = Boolean(windowStats && (windowStats.requests > 0 || windowStats.tokens > 0))

  return (
    <div className={className} title={title} data-testid={dataTestId} data-test={dataTest}>
      {/* Window stats row (above progress bar) */}
      {showStats && windowStats ? (
        <div className={styles.stats}>
          <span className={styles.chip}>{formatCompactNumber(windowStats.requests, { allowBillions: false })} req</span>
          <span className={styles.chip}>{formatCompactNumber(windowStats.tokens)}</span>
          <span className={styles.chip} title={t('usage.accountBilled')}>
            A ${windowStats.cost.toFixed(2)}
          </span>
          {windowStats.user_cost != null ? (
            <span className={styles.chip} title={t('usage.userBilled')}>
              U ${windowStats.user_cost.toFixed(2)}
            </span>
          ) : null}
          {estimatedTotalCost != null ? (
            <span
              className={styles.chip}
              data-test="estimated-total-cost"
              title={t('admin.accounts.usageWindow.estimatedTotalCostTooltip')}
            >
              {t('admin.accounts.usageWindow.estimatedTotalCost', { cost: estimatedTotalCost.toFixed(2) })}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Progress bar row */}
      <div className={styles.row}>
        {/* Label badge (label-width: fixed = 定宽居中, auto = 限宽截断左对齐) */}
        <span className={styles.label} data-color={color} data-label-width={labelWidth} data-testid="usage-bar-label">
          {label}
        </span>

        <div
          className={styles.track}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(Math.max(utilization, 0), 100)}
          aria-valuetext={displayPercent}
        >
          <div className={styles.fill} data-level={level} data-testid="usage-bar-fill" style={{ width: barWidth }} />
        </div>

        <span className={styles.percent} data-level={level} data-testid="usage-bar-percent">
          {displayPercent}
        </span>

        {shouldShowResetTime ? <span className={styles.reset}>{formatResetTime}</span> : null}
      </div>
    </div>
  )
}
