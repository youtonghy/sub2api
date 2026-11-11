/**
 * 模型广场分组内的模型价目表，对应 Vue 版 components/modelPlaza/PlazaModelPricingTable.vue。
 * 两级表头：实付区与官方区各拆输入 / 输出 / 缓存列；分时倍率的模型按时段额外展开行。
 * 测试钩子：阶梯档位行带 data-tier-row（对应 Vue 的 .leading-5），划线原倍率带 data-struck。
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react'

import type { UserPricingInterval } from '@/api/channels'
import type { PlazaModel, PlazaTimePricingPeriod } from '@/api/modelPlaza'
import {
  BILLING_MODE_IMAGE,
  BILLING_MODE_TOKEN,
  BILLING_MODE_VIDEO,
  REASONING_EFFORT_LEVELS,
  type BillingMode
} from '@/constants/channel'
import { useI18n } from '@/i18n/useI18n'
import { platformAccentColor, platformLabel } from '@/utils/platformColors'
import { formatScaled, resolveIntervalPrices } from '@/utils/pricing'
import styles from './PlazaModelPricingTable.module.css'

export interface PlazaModelPricingTableProps {
  models: PlazaModel[]
  /** 分组平台；实付分区底色随平台着色，未知平台回退品牌色。 */
  platform?: string
  /** 分组默认倍率。 */
  rateMultiplier: number
  /** 用户专属倍率；与默认不同，实付价按此计算并划线展示原倍率。 */
  userRateMultiplier?: number | null
  /** 生图独立倍率：true 时图片计费模型的实付倍率取 imageRateMultiplier，不取分组/专属倍率。 */
  imageRateIndependent?: boolean
  imageRateMultiplier?: number | null
  /** 视频独立倍率开启时，覆盖分组/用户专属倍率，与后端视频计费保持一致。 */
  videoRateIndependent?: boolean
  videoRateMultiplier?: number | null
  /**
   * 高峰窗口描述（含倍率与服务器时区标注），空串/缺省 = 分组未启用高峰。
   * 表格所有价格均为不含高峰因子的口径，该窗口仅用于分时时段行的 tooltip 披露：
   * 与高峰重叠的部分实付还会再乘高峰倍率。
   */
  peakWindow?: string
  peakRateMultiplier?: number | null
}

/** 表格行：每个模型一行标准价；配置了分时倍率的模型再按时段各加一行。 */
interface PlazaRow {
  model: PlazaModel
  period: PlazaTimePricingPeriod | null
  key: string
}

const PER_MILLION = 1_000_000

/** 价格统一保底 2 位小数，更长的有效小数原样保留。 */
const MIN_DECIMALS = 2

function reasoningEffortMultipliers(model: PlazaModel): [string, number][] {
  const multipliers = model.pricing?.reasoning_effort_multipliers
  return REASONING_EFFORT_LEVELS.flatMap((effort) => {
    const multiplier = multipliers?.[effort]
    return typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0
      ? [[effort, multiplier] as [string, number]]
      : []
  })
}

function billingMode(m: PlazaModel): BillingMode {
  return (m.pricing?.billing_mode || BILLING_MODE_TOKEN) as BillingMode
}

function hasCachePricing(m: PlazaModel): boolean {
  return m.pricing?.cache_write_price != null || m.pricing?.cache_write_1h_price != null || m.pricing?.cache_write_12h_price != null || m.pricing?.cache_read_price != null
}

function hasOfficialCache(o: NonNullable<PlazaModel['official_pricing']>): boolean {
  return o.cache_write_price != null || o.cache_read_price != null || o.cache_write_1h_price != null || o.cache_write_12h_price != null
}

/** 分时倍率时段（后端只给出倍率 ≠ 1 的时段，已升序）。 */
function timePeriods(m: PlazaModel): PlazaTimePricingPeriod[] {
  return m.time_pricing?.periods ?? []
}

/** “00:30–08:30”；整分钟的 HH:mm:ss 省略秒。 */
function formatTimeWindow(p: PlazaTimePricingPeriod): string {
  const clock = (v: string) => v.replace(/^(\d{2}:\d{2}):00$/, '$1')
  return `${clock(p.start_time)}–${clock(p.end_time)}`
}

/** 上下文档位按下限升序展示（后端已升序，此处兜底）。 */
function sortByContext(intervals: UserPricingInterval[]): UserPricingInterval[] {
  return [...intervals].sort((a, b) => a.min_tokens - b.min_tokens)
}

/** token 模式的阶梯定价（内联进输入/输出/缓存列）。 */
function tokenIntervals(m: PlazaModel): UserPricingInterval[] {
  return sortByContext(m.pricing?.intervals ?? []).map((iv) => resolveIntervalPrices(iv, m.pricing!))
}

/** 官方阶梯（后端按目录规则合成，不受分组开关影响）。 */
function officialIntervals(m: PlazaModel): UserPricingInterval[] {
  return sortByContext(m.official_pricing?.intervals ?? [])
}

/** 任一档带缓存价才按档渲染缓存列；否则沿用平价的写入/读取两行。 */
function hasTierCachePricing(intervals: UserPricingInterval[]): boolean {
  return intervals.some((iv) =>
    iv.cache_write_price != null || iv.cache_write_1h_price != null || iv.cache_write_12h_price != null || iv.cache_read_price != null ||
    iv.cache_write_multiplier != null || iv.cache_read_multiplier != null
  )
}

/** 按次/按图模式的阶梯定价（仅保留配了按次价的档位）。 */
function requestIntervals(m: PlazaModel): UserPricingInterval[] {
  return (m.pricing?.intervals ?? []).filter((iv) => iv.per_request_price != null)
}

function trimZero(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000)}M`
  if (n >= 1_000) return `${trimZero(n / 1_000)}K`
  return String(n)
}

/**
 * 档位标签：优先后端/管理员给出的 tier_label，否则按区间生成统一形态——
 * 有上限为「≤上限」，末档为「>下限」；档位升序排列，相邻的 ≤100K / ≤200K 即表示 (100K,200K]。
 */
function tierLabel(iv: UserPricingInterval): string {
  if (iv.tier_label) return iv.tier_label
  const { min_tokens: min, max_tokens: max } = iv
  return max == null ? `>${formatTokenCount(min)}` : `≤${formatTokenCount(max)}`
}

/** 官方参考价不乘倍率。 */
function official(value: number | null | undefined): string {
  if (value == null) return '-'
  return formatScaled(value, PER_MILLION, MIN_DECIMALS)
}

function hasIntervalCache(iv: UserPricingInterval): boolean {
  return iv.cache_write_price != null || iv.cache_write_1h_price != null || iv.cache_write_12h_price != null || iv.cache_read_price != null
}

export default function PlazaModelPricingTable({
  models,
  platform,
  rateMultiplier,
  userRateMultiplier,
  imageRateIndependent,
  imageRateMultiplier,
  videoRateIndependent,
  videoRateMultiplier,
  peakWindow,
  peakRateMultiplier
}: PlazaModelPricingTableProps) {
  const { t } = useI18n()

  const effectiveRate = userRateMultiplier ?? rateMultiplier
  const hasCustomRate = userRateMultiplier != null && userRateMultiplier !== rateMultiplier

  /** 实付分区只从平台拿一个主色，浅底/标题/下划线全部由 CSS 用 color-mix 派生。 */
  const accentStyle = { '--plaza-accent': platformAccentColor(platform ?? '') } as CSSProperties

  /**
   * 展示顺序：
   * 1. token 计费的排在前，按图/按次计费的沉到末尾——它们的官方 token 价与实付的按张/按次价不同量纲，混排无意义；
   * 2. 组内按官方输出价从高到低，无官方价的排最后；
   * 3. 同价按名称降序（新版本号在前，如 gpt-5.6 先于 gpt-5.5）。
   */
  const rows = useMemo<PlazaRow[]>(() => {
    const sorted = [...models].sort((a, b) => {
      const ta = billingMode(a) === BILLING_MODE_TOKEN
      const tb = billingMode(b) === BILLING_MODE_TOKEN
      if (ta !== tb) return ta ? -1 : 1
      const pa = a.official_pricing?.output_price ?? null
      const pb = b.official_pricing?.output_price ?? null
      if (pa != null && pb != null && pa !== pb) return pb - pa
      if (pa != null && pb == null) return -1
      if (pa == null && pb != null) return 1
      return b.name.localeCompare(a.name)
    })
    return sorted.flatMap((m) => {
      const base: PlazaRow = { model: m, period: null, key: `${m.platform}:${m.name}` }
      const periodRows = timePeriods(m).map<PlazaRow>((p, idx) => ({
        model: m,
        period: p,
        key: `${m.platform}:${m.name}:${idx}`
      }))
      return [base, ...periodRows]
    })
  }, [models])

  function billingModeLabel(m: PlazaModel): string {
    return billingMode(m) === BILLING_MODE_IMAGE
      ? t('modelPlaza.table.perImage')
      : t('modelPlaza.table.perRequest')
  }

  /** 时段行的生效倍率 = 生效倍率 × 时段倍率（去掉浮点噪声）。 */
  function periodRate(period: PlazaTimePricingPeriod): number {
    return Math.round(effectiveRate * period.multiplier * 1000) / 1000
  }

  /** 实付价 = 渠道单价 × 生效倍率（时段行再乘时段倍率），按 $/1M token 展示。 */
  function paidPerMillion(value: number | null | undefined, period: PlazaTimePricingPeriod | null = null): string {
    if (value == null) return '-'
    const rate = period ? periodRate(period) : effectiveRate
    return formatScaled(value * rate, PER_MILLION, MIN_DECIMALS)
  }

  /** 图片和视频分别使用对应的独立倍率开关。 */
  function usesIndependentMediaRate(m: PlazaModel): boolean {
    return (billingMode(m) === BILLING_MODE_IMAGE && imageRateIndependent === true) ||
      (billingMode(m) === BILLING_MODE_VIDEO && videoRateIndependent === true)
  }

  /** 非 token 行的生效倍率，图片和视频可分别覆盖通用倍率。 */
  function requestRate(m: PlazaModel): number {
    if (billingMode(m) === BILLING_MODE_VIDEO && videoRateIndependent === true) {
      return Math.max(0, videoRateMultiplier ?? 1)
    }
    return billingMode(m) === BILLING_MODE_IMAGE && imageRateIndependent === true
      ? (imageRateMultiplier ?? 1)
      : effectiveRate
  }

  /** 非 token 单价乘该行生效倍率，不换算为每百万 token。 */
  function paidRequestPrice(m: PlazaModel, value: number | null | undefined): string {
    if (value == null) return '-'
    return formatScaled(value * requestRate(m), 1, MIN_DECIMALS)
  }

  /** 非 token 计费的单位后缀：按图片 → “/ 张”，按次 → “/ 次”。 */
  function perUnitSuffix(m: PlazaModel): string {
    return billingMode(m) === BILLING_MODE_IMAGE
      ? t('modelPlaza.table.perUnitImage')
      : t('modelPlaza.table.perUnitRequest')
  }

  /**
   * 时段行 tooltip：仅工作日生效的配置换用带周末回落说明的文案；
   * 分组启用高峰倍率时追加披露——本行价格不含高峰因子，与高峰窗口重叠的部分实付再乘高峰倍率。
   */
  function timePricingRowHint(m: PlazaModel): string {
    const key = m.time_pricing?.weekdays_only
      ? 'modelPlaza.table.timePricingRowHintWeekdays'
      : 'modelPlaza.table.timePricingRowHint'
    let hint = t(key, { timezone: m.time_pricing?.timezone ?? '' })
    if (peakWindow) {
      hint += t('modelPlaza.table.timePricingRowHintPeak', {
        window: peakWindow,
        multiplier: peakRateMultiplier ?? 1
      })
    }
    return hint
  }

  /** 档位说明：整单按档计价，或（平台旧规则）仅超出部分按档计价。 */
  function tierHint(m: PlazaModel): string {
    return m.long_context_basis === 'marginal'
      ? t('modelPlaza.table.tierHintMarginal')
      : t('modelPlaza.table.tierHint')
  }

  const muted = (text: ReactNode) => <span className={styles.muted}>{text}</span>
  const dash = <span className={styles.muted}>-</span>

  /** 缓存列的写 / (1h) / (12h) / 读 一行，供实付与官方阶梯共用 */
  function tierCacheLine(iv: UserPricingInterval, format: (value: number | null | undefined) => string) {
    if (!hasIntervalCache(iv)) return dash
    return (
      <>
        {muted(t('modelPlaza.table.cacheWriteShort'))} {format(iv.cache_write_price)}
        {iv.cache_write_1h_price != null && (
          <>
            {muted(' (1h ')}
            {format(iv.cache_write_1h_price)}
            {muted(')')}
          </>
        )}
        {iv.cache_write_12h_price != null && (
          <>
            {muted(' (12h ')}
            {format(iv.cache_write_12h_price)}
            {muted(')')}
          </>
        )}{' '}
        <span className={`${styles.muted} ${styles.gapLeft}`}>{t('modelPlaza.table.cacheReadShort')}</span>{' '}
        {format(iv.cache_read_price)}
      </>
    )
  }

  function renderPaidCells(m: PlazaModel, period: PlazaTimePricingPeriod | null) {
    const paid = (value: number | null | undefined) => paidPerMillion(value, period)

    if (billingMode(m) !== BILLING_MODE_TOKEN) {
      // 按次 / 按图片计费：实付区整体合并，阶梯芯片或单一按次价
      const reqIntervals = requestIntervals(m)
      return (
        <td colSpan={3} className={styles.paidCell}>
          {reqIntervals.length ? (
            <div className={styles.chips}>
              {reqIntervals.map((iv, idx) => (
                <span key={idx} className={styles.chip}>
                  <span className={styles.chipLabel}>{tierLabel(iv)}</span> {paidRequestPrice(m, iv.per_request_price)}
                  <span className={styles.chipLabel}>{perUnitSuffix(m)}</span>
                </span>
              ))}
            </div>
          ) : m.pricing?.per_request_price != null ? (
            <>
              <span className={styles.price}>{paidRequestPrice(m, m.pricing.per_request_price)}</span>{' '}
              <span className={styles.unitSuffix}>{perUnitSuffix(m)}</span>
            </>
          ) : (
            dash
          )}
        </td>
      )
    }

    // token 计费：输入 / 输出 / 缓存（写/读），有阶梯时每档一行；档位标签只放输入列，其余列按行对齐
    const intervals = tokenIntervals(m)
    return (
      <>
        <td className={`${styles.paidCell} ${styles.price}`}>
          {intervals.length
            ? intervals.map((iv, idx) => (
                <div key={idx} className={styles.tierRow} data-tier-row="">
                  <span className={styles.tierLabel} title={tierHint(m)}>{tierLabel(iv)}</span> {paid(iv.input_price)}
                </div>
              ))
            : paid(m.pricing?.input_price)}
        </td>
        <td className={`${styles.paidCell} ${styles.price}`}>
          {intervals.length
            ? intervals.map((iv, idx) => (
                <div key={idx} className={styles.tierRow} data-tier-row="" title={tierHint(m)}>
                  {paid(iv.output_price)}
                </div>
              ))
            : paid(m.pricing?.output_price)}
        </td>
        <td className={styles.paidCell}>
          {hasTierCachePricing(intervals) ? (
            intervals.map((iv, idx) => (
              <div key={idx} className={`${styles.tierRow} ${styles.cacheText}`} data-tier-row="" title={tierHint(m)}>
                {tierCacheLine(iv, paid)}
              </div>
            ))
          ) : hasCachePricing(m) ? (
            <div className={styles.cacheStack}>
              <div>
                <span className={styles.cacheLabel}>{t('modelPlaza.table.cacheWrite')}</span> {paid(m.pricing?.cache_write_price)}
                {m.pricing?.cache_write_1h_price != null && (
                  <>
                    {muted(' (1h ')}
                    {paid(m.pricing.cache_write_1h_price)}
                    {muted(')')}
                  </>
                )}
                {m.pricing?.cache_write_12h_price != null && (
                  <>
                    {muted(' (12h ')}
                    {paid(m.pricing.cache_write_12h_price)}
                    {muted(')')}
                  </>
                )}
              </div>
              <div>
                <span className={styles.cacheLabel}>{t('modelPlaza.table.cacheRead')}</span> {paid(m.pricing?.cache_read_price)}
              </div>
            </div>
          ) : (
            dash
          )}
        </td>
      </>
    )
  }

  function renderOfficialCells(m: PlazaModel) {
    const intervals = officialIntervals(m)
    const op = m.official_pricing
    return (
      <>
        <td className={`${styles.officialCell} ${styles.sectionStart}`}>
          {intervals.length
            ? intervals.map((iv, idx) => (
                <div key={idx} className={styles.tierRow} data-tier-row="">
                  <span className={styles.tierLabel} title={t('modelPlaza.table.tierHint')}>{tierLabel(iv)}</span> {official(iv.input_price)}
                </div>
              ))
            : official(op?.input_price)}
        </td>
        <td className={styles.officialCell}>
          {intervals.length
            ? intervals.map((iv, idx) => (
                <div key={idx} className={styles.tierRow} data-tier-row="" title={t('modelPlaza.table.tierHint')}>
                  {official(iv.output_price)}
                </div>
              ))
            : official(op?.output_price)}
        </td>
        <td className={styles.officialCell}>
          {hasTierCachePricing(intervals) ? (
            intervals.map((iv, idx) => (
              <div key={idx} className={styles.tierRow} data-tier-row="" title={t('modelPlaza.table.tierHint')}>
                {tierCacheLine(iv, official)}
              </div>
            ))
          ) : op && hasOfficialCache(op) ? (
            <div className={styles.cacheStack}>
              <div>
                <span className={styles.cacheLabel}>{t('modelPlaza.table.cacheWrite')}</span> {official(op.cache_write_price)}
                {op.cache_write_1h_price != null && (
                  <>
                    {muted(' (1h ')}
                    {official(op.cache_write_1h_price)}
                    {muted(')')}
                  </>
                )}
                {op.cache_write_12h_price != null && (
                  <>
                    {muted(' (12h ')}
                    {official(op.cache_write_12h_price)}
                    {muted(')')}
                  </>
                )}
              </div>
              <div>
                <span className={styles.cacheLabel}>{t('modelPlaza.table.cacheRead')}</span> {official(op.cache_read_price)}
              </div>
            </div>
          ) : (
            dash
          )}
        </td>
      </>
    )
  }

  function renderRateCell(m: PlazaModel, period: PlazaTimePricingPeriod | null) {
    // 折扣倍率（分时时段行展示 生效倍率×时段倍率；生图独立倍率行展示独立倍率；专属倍率划线展示原倍率）
    let content: ReactNode
    if (period) {
      content = (
        <span
          className={styles.rateAccent}
          title={t('modelPlaza.table.timePricingRateHint', { rate: effectiveRate, multiplier: period.multiplier })}
        >
          {periodRate(period)}x
        </span>
      )
    } else if (usesIndependentMediaRate(m)) {
      content = <span className={styles.rate}>{requestRate(m)}x</span>
    } else if (hasCustomRate) {
      content = (
        <>
          <span className={styles.struck} data-struck="">{rateMultiplier}x</span>
          <span className={styles.rateAccent}>{effectiveRate}x</span>
        </>
      )
    } else {
      content = <span className={styles.rate}>{effectiveRate}x</span>
    }
    return <td className={styles.rateCell}>{content}</td>
  }

  return (
    <div className={styles.wrapper} style={accentStyle}>
      <table className={styles.table}>
        <colgroup>
          <col style={{ width: '25%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr className={styles.headRow}>
            <th rowSpan={2} className={styles.modelHead}>
              {t('modelPlaza.table.model')}
            </th>
            <th colSpan={3} className={`${styles.paidBg} ${styles.groupHead}`}>
              <div className={styles.paidTitle}>
                {t('modelPlaza.table.paidPrice')}
                <span className={styles.paidUnit}>{t('modelPlaza.table.unitPerMillion')}</span>
              </div>
            </th>
            <th colSpan={3} className={`${styles.groupHead} ${styles.sectionStart}`}>
              <div className={styles.officialTitle}>
                {t('modelPlaza.table.officialPrice')}
                <span className={styles.officialUnit}>{t('modelPlaza.table.unitPerMillion')}</span>
              </div>
            </th>
            <th rowSpan={2} className={styles.rateHead}>
              {t('modelPlaza.table.rate')}
            </th>
          </tr>
          <tr className={styles.subHeadRow}>
            <th className={styles.paidBg}>{t('modelPlaza.table.input')}</th>
            <th className={styles.paidBg}>{t('modelPlaza.table.output')}</th>
            <th className={styles.paidBg}>{t('modelPlaza.table.cache')}</th>
            <th className={styles.sectionStart}>{t('modelPlaza.table.input')}</th>
            <th>{t('modelPlaza.table.output')}</th>
            <th>{t('modelPlaza.table.cache')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ model: m, period, key }) => (
            <tr key={key} className={styles.row}>
              {/* 模型名 + 非 token 计费模式徽章；分时时段行额外标注时段 */}
              <td className={styles.modelCell}>
                <div className={styles.modelName}>
                  <span className={styles.name}>{m.name}</span>
                  {/* 时段徽章紧跟模型名，其余徽章排在后面，空间不足时先换行的是它们 */}
                  {period && (
                    <span className={styles.periodBadge} title={timePricingRowHint(m)}>
                      {m.time_pricing?.weekdays_only && (
                        <span className={styles.weekdays}>{t('modelPlaza.table.timePricingWeekdays')}</span>
                      )}
                      {formatTimeWindow(period)}
                    </span>
                  )}
                  {platform && m.platform !== platform && (
                    <span
                      className={styles.platformBadge}
                      style={{ '--badge-accent': platformAccentColor(m.platform) } as CSSProperties}
                    >
                      {platformLabel(m.platform)}
                    </span>
                  )}
                  {billingMode(m) !== BILLING_MODE_TOKEN && (
                    <span className={styles.tag}>{billingModeLabel(m)}</span>
                  )}
                  {m.long_context_basis === 'marginal' && (
                    <span className={styles.tag} title={t('modelPlaza.table.tierHintMarginal')}>
                      {t('modelPlaza.table.marginalBadge')}
                    </span>
                  )}
                  {reasoningEffortMultipliers(m).map(([effort, multiplier]) => (
                    <span
                      key={effort}
                      className={styles.reasoningTag}
                      title={t('modelPlaza.table.reasoningMultiplierHint', { effort, multiplier })}
                      data-reasoning-effort={effort}
                    >
                      {t('modelPlaza.table.reasoningMultiplierBadge', { effort, multiplier })}
                    </span>
                  ))}
                </div>
              </td>

              {renderPaidCells(m, period)}

              {/* 官方价格（参考价，不乘倍率；官方有阶梯时每档一行） */}
              {renderOfficialCells(m)}

              {renderRateCell(m, period)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

