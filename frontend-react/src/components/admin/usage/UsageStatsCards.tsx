import { MetricCard } from '@/components/arc/metric-card/metric-card'
import { Tooltip } from '@/components/arc/tooltip/tooltip'
import type { AdminUsageStatsResponse } from '@/api/admin/usage'
import { useI18n } from '@/i18n/useI18n'
import type { UsageStatsResponse } from '@/types'
import styles from './UsageStatsCards.module.css'

export interface UsageStatsCardsProps {
  stats: (AdminUsageStatsResponse | UsageStatsResponse) | null
  /** 默认 true：显示账号成本 */
  showAccountCost?: boolean
  /**
   * 用户端标准价为"划线价"。MetricCard 的 context 只接受纯文本，无法划线；
   * 保留该属性以兼容 Vue 版调用，标准价照常以文字显示。
   */
  strikeStandardCost?: boolean
}

const formatTokens = (value: number) => {
  if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B'
  if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M'
  if (value >= 1e3) return (value / 1e3).toFixed(2) + 'K'
  return value.toLocaleString()
}

/** 与 formatTokens 同档位，拆成 MetricCard 的数值 + 后缀 */
function splitTokens(value: number): { value: number; decimals: number; suffix: string } {
  if (value >= 1e9) return { value: Number((value / 1e9).toFixed(2)), decimals: 2, suffix: 'B' }
  if (value >= 1e6) return { value: Number((value / 1e6).toFixed(2)), decimals: 2, suffix: 'M' }
  if (value >= 1e3) return { value: Number((value / 1e3).toFixed(2)), decimals: 2, suffix: 'K' }
  return { value, decimals: 0, suffix: '' }
}

/** 与 Vue 版 formatDuration（ms < 1000 ? 'Xms' : 'X.XXs'）同规则，拆成 MetricCard 的数值 + 后缀 */
function splitDuration(ms: number): { value: number; decimals: number; suffix: string } {
  if (ms < 1000) return { value: Number(ms.toFixed(0)), decimals: 0, suffix: 'ms' }
  return { value: Number((ms / 1000).toFixed(2)), decimals: 2, suffix: 's' }
}

export default function UsageStatsCards({ stats, showAccountCost = true }: UsageStatsCardsProps) {
  const { t } = useI18n()

  const totalAccountCost = (stats as (AdminUsageStatsResponse & { total_account_cost?: number }) | null)?.total_account_cost ?? null
  const cacheLabel = () => t('usage.cacheTotal')
  const cacheDetailLabel = () => t('usage.cacheBreakdown')

  const tokens = splitTokens(stats?.total_tokens || 0)
  const duration = splitDuration(stats?.average_duration_ms || 0)
  const actualCost = Number((stats?.total_actual_cost || 0).toFixed(4))

  const tokenContext = [
    `${t('usage.in')}: ${formatTokens(stats?.total_input_tokens || 0)}`,
    `${t('usage.out')}: ${formatTokens(stats?.total_output_tokens || 0)}`,
    `${cacheLabel()}: ${formatTokens(stats?.total_cache_tokens || 0)}`
  ].join(' / ')

  const standardCost = `${t('usage.standardCost')} $${(stats?.total_cost || 0).toFixed(4)}`
  const costContext =
    showAccountCost && totalAccountCost != null
      ? `${t('usage.accountCost')} $${totalAccountCost.toFixed(4)} · ${standardCost}`
      : standardCost

  const cacheBreakdown = (
    <span className={styles.breakdown}>
      <span className={styles.breakdownTitle}>{cacheDetailLabel()}</span>
      <span className={styles.breakdownRow}>
        <span>{t('usage.cacheCreationTokensLabel')}</span>
        <span className={styles.breakdownValue}>{formatTokens(stats?.total_cache_creation_tokens || 0)}</span>
      </span>
      <span className={styles.breakdownRow}>
        <span>{t('usage.cacheReadTokensLabel')}</span>
        <span className={styles.breakdownValue}>{formatTokens(stats?.total_cache_read_tokens || 0)}</span>
      </span>
    </span>
  )

  return (
    <div className={styles.grid}>
      <MetricCard label={t('usage.totalRequests')} value={stats?.total_requests || 0} context={t('usage.inSelectedRange')} />
      {/* 缓存明细放在悬停/聚焦提示里，隐藏时不挂载，不撑宽布局 */}
      <Tooltip content={cacheBreakdown} side="bottom">
        <div className={styles.cell} tabIndex={0} data-testid="usage-stats-tokens">
          <MetricCard
            label={t('usage.totalTokens')}
            value={tokens.value}
            decimals={tokens.decimals}
            suffix={tokens.suffix}
            context={tokenContext}
          />
        </div>
      </Tooltip>
      <MetricCard label={t('usage.totalCost')} prefix="$" value={actualCost} decimals={4} context={costContext} />
      <MetricCard
        label={t('usage.avgDuration')}
        value={duration.value}
        decimals={duration.decimals}
        suffix={duration.suffix}
        context={t('usage.inSelectedRange')}
      />
    </div>
  )
}
