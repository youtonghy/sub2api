import { useI18n } from '@/i18n/useI18n'
import type { CurrencyAmounts, PaymentMethodStats } from '@/types/payment'
import { formatMoney, methodColor, sortedAmounts } from './paymentStats'
import styles from './AdminPayment.module.css'

export interface PaymentMethodChartProps {
  methods: PaymentMethodStats[]
  /** 是否显示每个币种的占比条（Vue 版 PaymentMethodChart 有，看板页内联版本没有），默认 true */
  showBars?: boolean
}

/** 支付方式分布，对应 Vue 版 PaymentMethodChart.vue */
export default function PaymentMethodChart({ methods, showBars = true }: PaymentMethodChartProps) {
  const { t } = useI18n()

  const maxAmounts = (methods ?? []).reduce<CurrencyAmounts>((maximums, method) => {
    for (const [currency, amount] of Object.entries(method.amount)) {
      maximums[currency] = Math.max(maximums[currency] || 0, amount)
    }
    return maximums
  }, {})

  const barWidth = (currency: string, amount: number) => Math.min((amount / (maxAmounts[currency] || 1)) * 100, 100)

  return (
    <section className={styles.panel} aria-labelledby="payment-method-chart-title">
      <h2 id="payment-method-chart-title" className={styles.panelTitle}>
        {t('payment.admin.paymentDistribution')}
      </h2>
      {!methods?.length ? (
        <p className={styles.emptyLine}>{t('payment.admin.noData')}</p>
      ) : (
        <ul className={styles.methodList}>
          {methods.map((method) => (
            <li key={method.type} className={styles.methodItem}>
              <div className={styles.methodRow}>
                <div className={styles.methodName}>
                  <span className={styles.dot} style={{ background: methodColor(method.type) }} aria-hidden="true" />
                  <span>{t('payment.methods.' + method.type, method.type)}</span>
                </div>
                <div className={styles.methodAmounts}>
                  {sortedAmounts(method.amount).map(([currency, amount]) => (
                    <span key={currency} className={styles.methodAmount}>
                      {formatMoney(currency, amount)}
                    </span>
                  ))}
                  <span className={styles.methodCount}>({method.count})</span>
                </div>
              </div>
              {showBars &&
                sortedAmounts(method.amount).map(([currency, amount]) => (
                  <div key={currency} className={styles.barRow}>
                    <span className={styles.barCurrency}>{currency}</span>
                    <div className={styles.barTrack} aria-hidden="true">
                      <div
                        className={styles.barFill}
                        style={{ width: barWidth(currency, amount) + '%', background: methodColor(method.type) }}
                      />
                    </div>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
