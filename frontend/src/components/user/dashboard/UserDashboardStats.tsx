import { useMemo, type CSSProperties } from 'react'

import { MetricCard } from '@/components/arc/metric-card/metric-card'
import type { PlatformDashboardStats, UserDashboardStats as UserStatsType } from '@/api/usage'
import { useI18n } from '@/i18n/useI18n'
import type { PlatformQuotaItem } from '@/types'
import styles from './UserDashboardStats.module.css'

interface FusedPlatformCard {
  platform: string
  total_actual_cost: number
  today_actual_cost: number
  total_requests: number
  total_tokens: number
  isOther?: boolean
  quota?: PlatformQuotaItem
}

export interface UserDashboardStatsProps {
  stats: UserStatsType
  balance: number
  isSimple: boolean
  platformQuotas?: PlatformQuotaItem[] | null
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
  minimax: 'MiniMax',
  typesafe: 'TypeSafe / Jev'
}

const platformLabel = (p: string) => PLATFORM_LABELS[p] ?? p

// 处理"各平台之和 < 总值"的差值：后端按平台聚合时过滤了无法归属平台的行
// （group 与 account 都缺 platform）。这里把差值作为"其他"卡片显式展示，
// 避免 Row 1 总值与 Row 3 平台拆分加总对不上、用户困惑。
const OTHER_THRESHOLD = 0.0001
const PLATFORM_ORDER = ['anthropic', 'openai', 'gemini', 'antigravity', 'grok', 'typesafe']

// Quota helpers

type QuotaWindow = 'daily' | 'weekly' | 'monthly'
type QuotaField = `${QuotaWindow}_limit_usd` | `${QuotaWindow}_usage_usd` | `${QuotaWindow}_window_resets_at`
const QUOTA_WINDOWS: QuotaWindow[] = ['daily', 'weekly', 'monthly']

function quotaVal(q: PlatformQuotaItem | undefined, key: QuotaField): PlatformQuotaItem[QuotaField] {
  return q?.[key]
}

function hasAnyLimit(q: PlatformQuotaItem | undefined): boolean {
  if (!q) return false
  return q.daily_limit_usd != null || q.weekly_limit_usd != null || q.monthly_limit_usd != null
}

function calcPercent(usage: number, limit: number): number {
  if (!limit || limit <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((usage / limit) * 100)))
}

/** 与 Vue 版 quotaBarClass 同阈值：≥95 红、≥75 琥珀、其余绿 */
function quotaTone(p: number): 'danger' | 'warning' | 'success' {
  if (p >= 95) return 'danger'
  if (p >= 75) return 'warning'
  return 'success'
}

// 与 formatBalance 一致使用 Intl.NumberFormat 做半偶舍入，避免 toFixed 在不同 JS 引擎
// 下偶发截断而非四舍五入（与后端展示精度不一致）。
const usdFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})
function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return usdFormatter.format(n)
}

function formatResetTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

const formatNumber = (n: number) => n.toLocaleString()
const formatCost = (c: number) => c.toFixed(4)
const formatTokens = (t: number) => {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`
  if (t >= 1000) return `${(t / 1000).toFixed(1)}K`
  return t.toString()
}

/** 与 formatTokens 同档位（1 位小数、K/M），拆成 MetricCard 的数值 + 后缀 */
function splitTokens(t: number): { value: number; decimals: number; suffix: string } {
  if (t >= 1_000_000) return { value: Number((t / 1_000_000).toFixed(1)), decimals: 1, suffix: 'M' }
  if (t >= 1000) return { value: Number((t / 1000).toFixed(1)), decimals: 1, suffix: 'K' }
  const fraction = t.toString().split('.')[1]?.length ?? 0
  return { value: t, decimals: Math.min(fraction, 3), suffix: '' }
}

/** 与 Vue 版 formatDuration（≥1000 为 X.XXs，否则 Xms）同规则，拆成数值 + 单位 */
function splitDuration(ms: number): { value: number; decimals: number; suffix: string } {
  if (ms >= 1000) return { value: Number((ms / 1000).toFixed(2)), decimals: 2, suffix: 's' }
  return { value: Number(ms.toFixed(0)), decimals: 0, suffix: 'ms' }
}

/** 用户仪表盘 KPI：核心统计、Token 统计与按平台拆分（含平台限额用量） */
export default function UserDashboardStats({ stats, balance, isSimple, platformQuotas }: UserDashboardStatsProps) {
  const { t } = useI18n()

  const platformCards = useMemo<FusedPlatformCard[]>(() => {
    // 建立 by_platform Map
    const byPlat = new Map<string, PlatformDashboardStats>()
    for (const item of stats?.by_platform ?? []) byPlat.set(item.platform, item)

    // 建立 quota Map。三档全空的记录不产生卡片，挂到卡片上也不渲染配额区。
    const byQuota = new Map<string, PlatformQuotaItem>()
    for (const q of platformQuotas ?? []) byQuota.set(q.platform, q)

    // 卡片集合 = 有用量的平台 ∪ 至少配置了一档限额的平台。
    // 三档全空的限额记录等价于不限额，不单独产生卡片。
    // 后端 by_platform / quota 接口均不会返回 platform='__other__'，
    // 无需显式排除；__other__ 由下方差值补差逻辑单独追加。
    const platforms = new Set<string>(byPlat.keys())
    for (const [platform, q] of byQuota) {
      if (hasAnyLimit(q)) platforms.add(platform)
    }

    const cards: FusedPlatformCard[] = []
    for (const p of platforms) {
      const stat = byPlat.get(p)
      cards.push({
        platform: p,
        total_actual_cost: stat?.total_actual_cost ?? 0,
        today_actual_cost: stat?.today_actual_cost ?? 0,
        total_requests: stat?.total_requests ?? 0,
        total_tokens: stat?.total_tokens ?? 0,
        quota: byQuota.get(p)
      })
    }

    // 排序：按 PLATFORM_ORDER，未知平台按名称排序
    cards.sort((a, b) => {
      const ai = PLATFORM_ORDER.indexOf(a.platform)
      const bi = PLATFORM_ORDER.indexOf(b.platform)
      if (ai === -1 && bi === -1) return a.platform.localeCompare(b.platform)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })

    // __other__ 补差逻辑：只对 by_platform 有 usage 数据的总和计算
    const total = stats?.total_actual_cost ?? 0
    const today = stats?.today_actual_cost ?? 0
    const sumTotal = cards.reduce((s, c) => s + c.total_actual_cost, 0)
    const sumToday = cards.reduce((s, c) => s + c.today_actual_cost, 0)
    const diffTotal = Math.max(0, total - sumTotal)
    const diffToday = Math.max(0, today - sumToday)

    if (diffTotal > OTHER_THRESHOLD || diffToday > OTHER_THRESHOLD) {
      cards.push({
        platform: '__other__',
        total_actual_cost: diffTotal,
        today_actual_cost: diffToday,
        total_requests: 0,
        total_tokens: 0,
        isOther: true
      })
    }

    return cards
  }, [stats, platformQuotas])

  // 标题右侧的平台计数 = 实际渲染的平台卡片数，不含"其他"差额卡。
  const platformCount = platformCards.filter((c) => !c.isOther).length

  const formatBalance = (b: number) =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(b)

  const todayTokens = splitTokens(stats?.today_tokens || 0)
  const totalTokens = splitTokens(stats?.total_tokens || 0)
  const rpm = splitTokens(stats?.rpm || 0)
  const duration = splitDuration(stats?.average_duration_ms || 0)
  const balanceValue = Number(formatBalance(balance).replace(/,/g, ''))

  const tokenContext = (input: number, output: number, cache: number) =>
    `${t('dashboard.input')}: ${formatTokens(input)} / ${t('dashboard.output')}: ${formatTokens(output)} / ${t('dashboard.cache')}: ${formatTokens(cache)}`
  const costTitle = `${t('dashboard.actual')} / ${t('dashboard.standard')}`
  const todayCostContext =
    `${t('dashboard.standard')} $${formatCost(stats?.today_cost || 0)} · ` +
    `${t('common.total')}: $${formatCost(stats?.total_actual_cost || 0)} / $${formatCost(stats?.total_cost || 0)}`

  const renderQuota = (quota: PlatformQuotaItem | undefined) => (
    <div className={styles.quota}>
      <p className={styles.quotaTitle}>{t('dashboard.platformQuota.title')}</p>
      {QUOTA_WINDOWS.map((w) => {
        const limit = quotaVal(quota, `${w}_limit_usd`) as number | null | undefined
        if (limit == null) return null
        // limit=0：完全禁用
        if (limit === 0) {
          return (
            <div key={w} className={styles.quotaRow}>
              <div className={styles.quotaLine}>
                <span className={styles.quotaLabel}>{t(`dashboard.platformQuota.${w}`)}</span>
                <span className={styles.quotaDisabled}>{t('dashboard.platformQuota.disabled')}</span>
              </div>
              <div className={styles.meter} data-tone="danger" aria-hidden="true">
                <span className={styles.meterFill} style={{ width: '100%' }} />
              </div>
            </div>
          )
        }
        // limit>0：正常用量进度条
        const usage = (quotaVal(quota, `${w}_usage_usd`) as number | null | undefined) ?? 0
        const percent = calcPercent(usage, limit)
        const resetsAt = quotaVal(quota, `${w}_window_resets_at`) as string | null | undefined
        return (
          <div key={w} className={styles.quotaRow}>
            <div className={styles.quotaLine}>
              <span className={styles.quotaLabel}>{t(`dashboard.platformQuota.${w}`)}</span>
              <span className={styles.quotaValue}>
                ${formatUsd(usage)} / ${formatUsd(limit)}
              </span>
            </div>
            <div
              className={styles.meter}
              data-tone={quotaTone(percent)}
              role="progressbar"
              aria-label={t(`dashboard.platformQuota.${w}`)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span className={styles.meterFill} style={{ width: `${percent}%` } as CSSProperties} />
            </div>
            {resetsAt ? (
              <p className={styles.quotaReset}>
                {t('dashboard.platformQuota.resetsAt', { time: formatResetTime(resetsAt) })}
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )

  return (
    <>
      {/* Row 1: Core Stats */}
      <div className={styles.kpiRow}>
        {!isSimple && (
          <MetricCard
            label={t('dashboard.balance')}
            prefix="$"
            value={balanceValue}
            decimals={2}
            context={t('common.available')}
          />
        )}
        <MetricCard
          label={t('dashboard.apiKeys')}
          value={stats?.total_api_keys || 0}
          context={`${stats?.active_api_keys || 0} ${t('common.active')}`}
        />
        <MetricCard
          label={t('dashboard.todayRequests')}
          value={stats?.today_requests || 0}
          context={`${t('common.total')}: ${formatNumber(stats?.total_requests || 0)}`}
        />
        <div className={styles.kpiCell} title={costTitle}>
          <MetricCard
            label={t('dashboard.todayCost')}
            prefix="$"
            value={Number(formatCost(stats?.today_actual_cost || 0))}
            decimals={4}
            context={todayCostContext}
          />
        </div>
      </div>

      {/* Row 2: Token Stats */}
      <div className={styles.kpiRow}>
        <MetricCard
          label={t('dashboard.todayTokens')}
          value={todayTokens.value}
          decimals={todayTokens.decimals}
          suffix={todayTokens.suffix}
          context={tokenContext(
            stats?.today_input_tokens || 0,
            stats?.today_output_tokens || 0,
            (stats?.today_cache_creation_tokens || 0) + (stats?.today_cache_read_tokens || 0)
          )}
        />
        <MetricCard
          label={t('dashboard.totalTokens')}
          value={totalTokens.value}
          decimals={totalTokens.decimals}
          suffix={totalTokens.suffix}
          context={tokenContext(
            stats?.total_input_tokens || 0,
            stats?.total_output_tokens || 0,
            (stats?.total_cache_creation_tokens || 0) + (stats?.total_cache_read_tokens || 0)
          )}
        />
        {/* Performance (RPM/TPM) */}
        <MetricCard
          label={t('dashboard.performance')}
          value={rpm.value}
          decimals={rpm.decimals}
          suffix={`${rpm.suffix} RPM`}
          context={`${formatTokens(stats?.tpm || 0)} TPM`}
        />
        <MetricCard
          label={t('dashboard.avgResponse')}
          value={duration.value}
          decimals={duration.decimals}
          suffix={duration.suffix}
          context={t('dashboard.averageTime')}
        />
      </div>

      {/* Row 3: Per-platform breakdown */}
      {!isSimple && platformCards.length > 0 && (
        <section className={styles.panel} aria-labelledby="user-dashboard-platforms">
          <div className={styles.panelHeader}>
            <h2 id="user-dashboard-platforms" className={styles.panelTitle}>
              {t('dashboard.platformBreakdown')}
            </h2>
            <span className={styles.panelMeta}>{t('dashboard.platformCount', { count: platformCount })}</span>
          </div>
          <div className={styles.platformGrid}>
            {platformCards.map((item) => (
              <div
                key={item.platform}
                data-testid="platform-card"
                data-platform={item.platform}
                className={item.isOther ? `${styles.platform} ${styles.platformOther}` : styles.platform}
              >
                <div className={styles.platformHead}>
                  <span className={styles.platformName}>
                    {item.isOther ? t('dashboard.platformOther') : platformLabel(item.platform)}
                  </span>
                  <span className={styles.platformCost} title={t('dashboard.actual')}>
                    ${formatCost(item.total_actual_cost)}
                  </span>
                </div>
                <dl className={styles.platformStats}>
                  <div>
                    <dt>{t('dashboard.todayCost')}</dt>
                    <dd>${formatCost(item.today_actual_cost)}</dd>
                  </div>
                  <div>
                    <dt>{t('dashboard.requests')}</dt>
                    <dd>{item.total_requests > 0 ? formatNumber(item.total_requests) : '-'}</dd>
                  </div>
                  <div>
                    <dt>{t('dashboard.tokens')}</dt>
                    <dd>{item.total_tokens > 0 ? formatTokens(item.total_tokens) : '-'}</dd>
                  </div>
                </dl>

                {/* Quota 区：仅当 quota 配置存在、非 __other__ 且至少有一个窗口配了 limit 时显示 */}
                {hasAnyLimit(item.quota) && !item.isOther ? renderQuota(item.quota) : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
