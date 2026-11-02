import { useI18n } from '@/i18n/useI18n'
import alipayIcon from '@/assets/icons/alipay.svg'
import wxpayIcon from '@/assets/icons/wxpay.svg'
import stripeIcon from '@/assets/icons/stripe.svg'
import airwallexIcon from '@/assets/icons/airwallex.svg'
import paymentIcon from '@/assets/icons/payment.svg'
import { METHOD_ORDER, isBuiltInAlipayMethod, isBuiltInWxpayMethod } from './providerConfig'
import styles from './PaymentMethodSelector.module.css'

export interface PaymentMethodOption {
  type: string
  display_name?: string
  fee_rate: number
  available: boolean
}

export interface PaymentMethodSelectorProps {
  methods: PaymentMethodOption[]
  selected: string
  onSelect?: (type: string) => void
}

const METHOD_ICONS: Record<string, string> = {
  alipay: alipayIcon,
  wxpay: wxpayIcon,
  stripe: stripeIcon,
  airwallex: airwallexIcon,
  credit_card: paymentIcon,
}

function methodIcon(type: string): string {
  if (isBuiltInAlipayMethod(type)) return METHOD_ICONS.alipay
  if (isBuiltInWxpayMethod(type)) return METHOD_ICONS.wxpay
  if (type === 'airwallex') return METHOD_ICONS.airwallex
  return METHOD_ICONS[type] || paymentIcon
}

/** 选中态品牌：内置支付宝 / 微信 / Stripe / Airwallex，其余（含名称里带内置名的自定义方式）为通用样式 */
function methodBrand(type: string): 'alipay' | 'wxpay' | 'stripe' | 'airwallex' | 'generic' {
  if (isBuiltInAlipayMethod(type)) return 'alipay'
  if (isBuiltInWxpayMethod(type)) return 'wxpay'
  if (type === 'stripe') return 'stripe'
  if (type === 'airwallex') return 'airwallex'
  return 'generic'
}

export default function PaymentMethodSelector({ methods, selected, onSelect }: PaymentMethodSelectorProps) {
  const { t } = useI18n()

  const order: readonly string[] = METHOD_ORDER
  const sortedMethods = [...methods].sort((a, b) => {
    const ai = order.indexOf(a.type)
    const bi = order.indexOf(b.type)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  function methodLabel(method: PaymentMethodOption): string {
    return method.display_name || t(`payment.methods.${method.type}`, method.type)
  }

  return (
    <div className={styles.root}>
      <span className={styles.label}>{t('payment.paymentMethod')}</span>
      <div data-testid="payment-method-grid" className={styles.grid} role="radiogroup" aria-label={t('payment.paymentMethod')}>
        {sortedMethods.map((method) => {
          const label = methodLabel(method)
          const isSelected = selected === method.type
          return (
            <button
              key={method.type}
              type="button"
              role="radio"
              aria-checked={isSelected}
              title={label}
              disabled={!method.available}
              className={styles.method}
              data-selected={isSelected && method.available ? '' : undefined}
              data-brand={methodBrand(method.type)}
              onClick={() => {
                if (method.available) onSelect?.(method.type)
              }}
            >
              <img src={methodIcon(method.type)} alt={label} className={styles.icon} />
              <span className={styles.text}>
                <span data-testid="payment-method-label" className={styles.name}>
                  {label}
                </span>
                {method.fee_rate > 0 && (
                  <span className={styles.fee}>
                    {t('payment.fee')} {method.fee_rate}%
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
