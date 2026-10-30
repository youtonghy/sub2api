/**
 * 用户用量单元格，对应 Vue 版 PlatformUsageBreakdown.vue：今日 / 累计费用，
 * 悬停（或键盘聚焦）时用 Arc tooltip 展示各平台明细。
 */
import { Info } from 'lucide-react'

import type { PlatformUsage } from '@/api/admin/dashboard'
import { Tooltip } from '@/components/arc/tooltip/tooltip'
import { useI18n } from '@/i18n/useI18n'
import styles from './userCells.module.css'

export interface PlatformUsageBreakdownProps {
  today: number
  total: number
  byPlatform?: PlatformUsage[]
}

// 与 UserDashboardStats 保持一致：把"总值 - 各平台之和"的差作为"其他"行展示，
// 避免 tooltip 内各平台费用加总与列首总值对不上。
const OTHER_THRESHOLD = 0.0001

interface BreakdownRow {
  platform: string
  today_actual_cost: number
  total_actual_cost: number
  isOther?: boolean
}

const PLATFORM_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
  kimi: 'Kimi',
  zhipu: 'Zhipu GLM',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax'
}

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform
}

function buildBreakdown(today: number, total: number, byPlatform?: PlatformUsage[]): BreakdownRow[] {
  const list = byPlatform ?? []
  const rows: BreakdownRow[] = [...list]
    .sort((a, b) => b.total_actual_cost - a.total_actual_cost)
    .map((p) => ({ ...p }))

  const sumTotal = rows.reduce((s, r) => s + r.total_actual_cost, 0)
  const sumToday = rows.reduce((s, r) => s + r.today_actual_cost, 0)
  const diffTotal = Math.max(0, total - sumTotal)
  const diffToday = Math.max(0, today - sumToday)
  if (diffTotal > OTHER_THRESHOLD || diffToday > OTHER_THRESHOLD) {
    rows.push({
      platform: '__other__',
      today_actual_cost: diffToday,
      total_actual_cost: diffTotal,
      isOther: true
    })
  }
  return rows
}

export default function PlatformUsageBreakdown({ today, total, byPlatform }: PlatformUsageBreakdownProps) {
  const { t } = useI18n()
  const sortedBreakdown = buildBreakdown(today, total, byPlatform)
  const hasBreakdown = sortedBreakdown.length > 0

  const summary = (
    <div
      className={[styles.stack, hasBreakdown ? styles.trigger : undefined].filter(Boolean).join(' ')}
      tabIndex={hasBreakdown ? 0 : undefined}
    >
      <div className={styles.row}>
        <span className={styles.label}>{t('admin.users.today')}:</span>
        <span className={styles.value}>${today.toFixed(4)}</span>
        {hasBreakdown && <Info size={12} strokeWidth={2} className={styles.infoIcon} aria-hidden="true" />}
      </div>
      <div className={styles.row}>
        <span className={styles.label}>{t('admin.users.total')}:</span>
        <span className={styles.value}>${total.toFixed(4)}</span>
      </div>
    </div>
  )

  if (!hasBreakdown) return summary

  return (
    <Tooltip
      side="right"
      content={
        <div className={styles.breakdown}>
          <div className={styles.breakdownHeader}>
            <span>{t('admin.users.platformBreakdown')}</span>
            <span className={styles.mono}>
              {t('admin.users.today')} / {t('admin.users.total')}
            </span>
          </div>
          {sortedBreakdown.map((item) => (
            <div
              key={item.platform}
              className={[styles.breakdownRow, item.isOther ? styles.breakdownOther : undefined].filter(Boolean).join(' ')}
            >
              <span>{item.isOther ? t('admin.users.platformOther') : platformLabel(item.platform)}</span>
              <span className={styles.mono}>
                ${item.today_actual_cost.toFixed(4)} <span className={styles.separator}>/</span> $
                {item.total_actual_cost.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      }
    >
      {summary}
    </Tooltip>
  )
}
