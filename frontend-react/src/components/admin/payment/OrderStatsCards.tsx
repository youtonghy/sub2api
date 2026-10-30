import { MetricCard } from '@/components/arc/metric-card/metric-card'
import { useI18n } from '@/i18n/useI18n'
import type { CurrencyAmounts, DashboardStats } from '@/types/payment'
import { formatMoney, sortedAmounts, splitMoney } from './paymentStats'
import styles from './AdminPayment.module.css'

export interface OrderStatsCardsProps {
  stats: DashboardStats
}

/**
 * 金额 KPI：按币种排序后第一个币种作为主数值，其余币种的金额放在说明行
 * （Vue 版每个币种各占一行大号数字）。没有任何币种时主数值为 0。
 */
function moneyMetric(amounts: CurrencyAmounts) {
  const entries = sortedAmounts(amounts)
  const [primary, ...rest] = entries
  const main = primary ? splitMoney(primary[0], primary[1]) : { prefix: '', suffix: '', value: 0, decimals: 0 }
  return { main, others: rest.map(([currency, amount]) => formatMoney(currency, amount)) }
}

/** 支付看板 KPI，对应 Vue 版 OrderStatsCards.vue */
export default function OrderStatsCards({ stats }: OrderStatsCardsProps) {
  const { t } = useI18n()

  const today = moneyMetric(stats.today_amount)
  const total = moneyMetric(stats.total_amount)
  const avg = moneyMetric(stats.avg_amount)

  const ordersText = (count: number) => `${count} ${t('payment.admin.orders')}`

  return (
    <div className={styles.kpis}>
      {/* Today Revenue */}
      <MetricCard
        label={t('payment.admin.todayRevenue')}
        value={today.main.value}
        prefix={today.main.prefix}
        suffix={today.main.suffix}
        decimals={today.main.decimals}
        context={[...today.others, ordersText(stats.today_count)].join(' · ')}
      />
      {/* Total Revenue */}
      <MetricCard
        label={t('payment.admin.totalRevenue')}
        value={total.main.value}
        prefix={total.main.prefix}
        suffix={total.main.suffix}
        decimals={total.main.decimals}
        context={[...total.others, ordersText(stats.total_count)].join(' · ')}
      />
      {/* Today Orders */}
      <MetricCard label={t('payment.admin.todayOrders')} value={stats.today_count} context="" />
      {/* Average Amount */}
      <MetricCard
        label={t('payment.admin.avgAmount')}
        value={avg.main.value}
        prefix={avg.main.prefix}
        suffix={avg.main.suffix}
        decimals={avg.main.decimals}
        context={avg.others.join(' · ')}
      />
    </div>
  )
}
