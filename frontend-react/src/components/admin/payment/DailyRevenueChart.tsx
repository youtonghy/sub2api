import { useMemo } from 'react'

import { LineChart, type LineChartDatum, type LineChartSeries } from '@/components/arc/line-chart/line-chart'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { axisLabelOf } from '@/components/charts/chartUtils'
import { useKeepOneSeries } from '@/components/charts/useKeepOneSeries'
import { useI18n } from '@/i18n/useI18n'
import type { DailyPaymentStats } from '@/types/payment'
import { formatMoney } from './paymentStats'
import styles from './AdminPayment.module.css'

export interface DailyRevenueChartProps {
  data: DailyPaymentStats[]
  loading?: boolean
}

const COUNT_KEY = '__count'

/**
 * 每日收入趋势，对应 Vue 版 DailyRevenueChart.vue（chart.js 双 y 轴折线图）。
 * 这里拆成两张共享横轴日期的 Arc 折线图：上方为各币种收入，下方为订单数的紧凑折线。
 */
export default function DailyRevenueChart({ data, loading = false }: DailyRevenueChartProps) {
  const { t } = useI18n()

  const currencies = useMemo(
    () => [...new Set((data ?? []).flatMap((day) => Object.keys(day.amount)))].sort(),
    [data]
  )

  // 不超过 4 个系列时用 Arc 默认色板，更多时用分类色板
  const revenueSeries = useMemo<LineChartSeries[]>(
    () =>
      currencies.map((currency, index) => ({
        key: currency,
        label: `${currency} ${t('payment.admin.revenue')}`,
        area: true,
        ...(currencies.length > 4 ? { color: `var(--chart-cat-${(index % 12) + 1})` } : {})
      })),
    [currencies, t]
  )
  const countSeries = useMemo<LineChartSeries[]>(
    () => [{ key: COUNT_KEY, label: t('payment.admin.orderCount'), area: false }],
    [t]
  )
  const revenueVisibility = useKeepOneSeries(revenueSeries)

  const revenueData = useMemo<LineChartDatum[]>(
    () =>
      (data ?? []).map((day) => ({
        key: day.date,
        label: day.date,
        axisLabel: axisLabelOf(day.date),
        values: Object.fromEntries(currencies.map((currency) => [currency, day.amount[currency] || 0]))
      })),
    [data, currencies]
  )
  const countData = useMemo<LineChartDatum[]>(
    () =>
      (data ?? []).map((day) => ({
        key: day.date,
        label: day.date,
        axisLabel: axisLabelOf(day.date),
        values: { [COUNT_KEY]: day.count }
      })),
    [data]
  )

  const empty = !data || data.length === 0

  return (
    <section className={styles.panel} aria-labelledby="daily-revenue-title" aria-busy={loading || undefined}>
      <h2 id="daily-revenue-title" className={styles.panelTitle}>
        {t('payment.admin.dailyRevenue')}
      </h2>
      {loading && empty ? (
        <Skeleton lines={6} label={t('common.loading')} />
      ) : empty ? (
        <p className={styles.emptyLine}>{t('payment.admin.noData')}</p>
      ) : (
        <div className={styles.trend}>
          <LineChart
            data={revenueData}
            series={revenueSeries}
            label={t('payment.admin.revenue')}
            height={208}
            loading={loading}
            emptyLabel={t('payment.admin.noData')}
            formatValue={(value, series) => formatMoney(series.key, value)}
            hiddenSeries={revenueVisibility.hidden}
            onHiddenSeriesChange={revenueVisibility.onHiddenChange}
          />
          <LineChart
            data={countData}
            series={countSeries}
            label={t('payment.admin.orderCount')}
            height={88}
            loading={loading}
            legend
            emptyLabel={t('payment.admin.noData')}
            formatValue={(value) => String(Math.round(value))}
          />
        </div>
      )}
    </section>
  )
}
