import { useEffect, useState } from 'react'

import type { MonitorQuotaSnapshot, MonitorQuotaTier } from '@/api/admin/channelMonitor'
import { useI18n } from '@/i18n/useI18n'
import styles from './MonitorQuotaView.module.css'

export interface MonitorQuotaViewProps {
  snapshot?: MonitorQuotaSnapshot | null
}

type TierColor = 'indigo' | 'emerald' | 'purple' | 'amber'

interface QuotaTierRow {
  key: string
  label: string
  title: string
  color: TierColor
  tier: MonitorQuotaTier
}

// 已知的 window/label 机器 token → i18n key（monitorCommon.quota.*）。
const windowI18nKeys: Record<string, string> = {
  '5h': 'monitorCommon.quota.windows.5h',
  '7d': 'monitorCommon.quota.windows.7d',
  '7d-sonnet': 'monitorCommon.quota.windows.7dSonnet',
  '7d-fable': 'monitorCommon.quota.windows.7dFable',
  weekly: 'monitorCommon.quota.windows.weekly',
  daily: 'monitorCommon.quota.windows.daily',
  '30d': 'monitorCommon.quota.windows.30d',
  total: 'monitorCommon.quota.windows.total'
}

const labelI18nKeys: Record<string, string> = {
  requests: 'monitorCommon.quota.labels.requests',
  tokens: 'monitorCommon.quota.labels.tokens',
  shared: 'monitorCommon.quota.labels.shared',
  pro: 'monitorCommon.quota.labels.pro',
  flash: 'monitorCommon.quota.labels.flash'
}

// tier 配色按数组顺序轮转（与账号页用量条相同的色板）。
const tierColors: TierColor[] = ['indigo', 'emerald', 'purple', 'amber']

/** 只在显示重置倒计时时每分钟刷新一次，避免长列表里堆积空闲定时器；页面回到前台时立即刷新 */
function useNow(resetsAt: string | null): Date {
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
    const refreshWhenVisible = () => {
      if (!document.hidden) setNow(new Date())
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [active])
  return now
}

/**
 * 用量窗口条：账号页 UsageProgressBar（label-width="auto"）的精简版，只包含本组件用到的部分：
 * 同阈值配色（≥90 危险 / ≥75 警告 / 其余成功）、同倒计时格式。账号组件迁移后可替换为共享实现。
 */
function TierBar({ label, title, color, utilization, resetsAt }: {
  label: string
  title: string
  color: TierColor
  utilization: number
  resetsAt: string | null
}) {
  const { t } = useI18n()
  const now = useNow(resetsAt)

  const level = utilization >= 90 ? 'danger' : utilization >= 75 ? 'warning' : 'success'
  const barWidth = `${Math.min(Math.max(utilization, 0), 100)}%`
  const percent = Math.round(utilization)
  const displayPercent = percent > 999 ? '>999%' : `${percent}%`

  const resetText = (() => {
    if (!resetsAt) return ''
    const diffMs = new Date(resetsAt).getTime() - now.getTime()
    // resetsAt 已过期：utilization>0 说明后端窗口数据还没刷新，显示「待刷新」以区别于真正可用的「现在」。
    if (diffMs <= 0) return utilization > 0 ? t('usage.resetPending') : t('usage.resetNow')
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    if (diffHours >= 24) return `${Math.floor(diffHours / 24)}d ${diffHours % 24}h`
    if (diffHours > 0) return `${diffHours}h ${diffMins}m`
    return `${diffMins}m`
  })()

  return (
    <div className={styles.tier} data-testid="monitor-quota-tier" title={title}>
      <span className={styles.tierLabel} data-color={color}>
        {label}
      </span>
      <div className={styles.track}>
        <div className={styles.fill} data-level={level} style={{ width: barWidth }} />
      </div>
      <span className={styles.percent} data-level={level}>
        {displayPercent}
      </span>
      {resetsAt && <span className={styles.reset}>{resetText}</span>}
    </div>
  )
}

/**
 * 配额快照渲染（管理端监控列表/运行结果 + 用户端监控卡片共用）。
 * 用量条与账号页 UsageProgressBar 同阈值配色、同倒计时格式；tier 的
 * Window/Label 是后端约定的机器 token，已知 token 走 i18n，未知 token
 * 原样展示（前向兼容）。
 */
export default function MonitorQuotaView({ snapshot }: MonitorQuotaViewProps) {
  const { t, te } = useI18n()

  if (!snapshot) return null

  const windowLabel = (window: string): string => {
    const key = windowI18nKeys[window]
    return key && te(key) ? t(key) : window
  }

  const tierLabel = (tier: MonitorQuotaTier): string => {
    const window = windowLabel(tier.window)
    if (!tier.label) return window
    const labelKey = labelI18nKeys[tier.label]
    const label = labelKey && te(labelKey) ? t(labelKey) : tier.label
    return `${label}/${window}`
  }

  const tierRows: QuotaTierRow[] = (snapshot.tiers || []).map((tier, idx) => ({
    key: `${tier.window}-${tier.label || ''}-${idx}`,
    label: tierLabel(tier),
    title: tierLabel(tier),
    color: tierColors[idx % tierColors.length],
    tier
  }))

  const balanceRows = snapshot.balances?.length
    ? snapshot.balances
    : snapshot.balance != null
      ? [{ currency: snapshot.currency || '?', balance: snapshot.balance }]
      : []

  const error = snapshot.error || t('monitorCommon.quota.unavailable')
  const truncatedError = error.length > 48 ? `${error.slice(0, 48)}…` : error

  return (
    <div className={styles.root} data-testid="monitor-quota-view">
      {/* 套餐等级徽章（如智谱 plan level / Claude 订阅档） */}
      {snapshot.plan_level && (
        <div className={styles.planRow}>
          <span className={styles.plan}>{snapshot.plan_level}</span>
        </div>
      )}

      {/* 用量窗口条形图 */}
      {snapshot.success && tierRows.length > 0 && (
        <div className={styles.tiers}>
          {tierRows.map((row) => (
            <TierBar
              key={row.key}
              label={row.label}
              title={row.title}
              color={row.color}
              utilization={row.tier.used_percent}
              resetsAt={row.tier.reset_at ?? null}
            />
          ))}
        </div>
      )}

      {/* 余额（国产 payg；支持多币种） */}
      {snapshot.success && balanceRows.length > 0 && (
        <div className={styles.balances}>
          {balanceRows.map((b) => (
            <span key={b.currency} className={styles.balance} data-empty={b.balance <= 0 ? '' : undefined}>
              {b.balance.toFixed(2)} {b.currency}
            </span>
          ))}
        </div>
      )}

      {!snapshot.success && (
        <div className={styles.error} title={snapshot.error} data-testid="monitor-quota-error">
          {truncatedError}
        </div>
      )}
    </div>
  )
}
