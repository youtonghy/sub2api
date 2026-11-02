import { useId, useState } from 'react'

import { Badge } from '@/components/arc/badge/badge'
import Input from '@/components/common/Input'
import { useI18n } from '@/i18n/useI18n'
import type { RechargeBonusTier } from '@/types/payment'
import { formatRechargeBonusNumber, quoteRechargeBonus, type RechargeBonusMode } from '@/utils/rechargeBonus'
import { formatPaymentAmount } from './currency'
import styles from './AmountInput.module.css'

export interface AmountInputProps {
  amounts?: number[]
  /** 当前金额（Vue 版 modelValue） */
  value: number | null
  /** 金额变化（Vue 版 update:modelValue） */
  onChange?: (value: number | null) => void
  min?: number
  max?: number
  /** 充值优惠阶梯（按 min_amount 升序）；为空时不显示价签与第二行 */
  bonusTiers?: RechargeBonusTier[]
  /** 阶梯模式：bonus 赠金 / discount 折扣 */
  bonusMode?: RechargeBonusMode
  /** 充值倍率（1 支付币种 = multiplier USD），用于计算到账金额 */
  multiplier?: number
  /** 支付币种（折扣模式第二行实付金额的币种与精度） */
  currency?: string
}

const DEFAULT_AMOUNTS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
const NO_TIERS: RechargeBonusTier[] = []
const AMOUNT_PATTERN = /^\d*(\.\d{0,2})?$/

function currencyDigits(currency: string | undefined): number {
  if (!currency) return 2
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export default function AmountInput({
  amounts = DEFAULT_AMOUNTS,
  value,
  onChange,
  min = 0,
  max = 0,
  bonusTiers = NO_TIERS,
  bonusMode = 'bonus',
  multiplier = 1,
  currency,
}: AmountInputProps) {
  const { t } = useI18n()
  const inputId = useId()
  const [customText, setCustomText] = useState(() => (value !== null ? String(value) : ''))
  const [prevValue, setPrevValue] = useState(value)

  // 对应 Vue 版 watch(modelValue)：外部金额变化且与输入框文本不一致时同步
  if (value !== prevValue) {
    setPrevValue(value)
    if (value !== null && String(value) !== customText) {
      setCustomText(String(value))
    }
  }

  // 0 = no limit
  const filteredAmounts = amounts.filter((a) => (min <= 0 || a >= min) && (max <= 0 || a <= max))
  const showSecondLine = bonusTiers.length > 0

  function quoteFor(amt: number) {
    return quoteRechargeBonus(bonusTiers, amt, {
      multiplier,
      mode: bonusMode,
      currencyDigits: currencyDigits(currency),
    })
  }

  // 价签文案：赠金「+20%」，折扣「20% OFF」
  function badgeText(amt: number): string {
    const percent = formatRechargeBonusNumber(quoteFor(amt).percent)
    return bonusMode === 'discount' ? `${percent}% OFF` : `+${percent}%`
  }

  function secondLine(amt: number): string {
    const quote = quoteFor(amt)
    if (bonusMode === 'discount') {
      return t('payment.rechargeBonus.payShort', { amount: formatPaymentAmount(quote.payBase, currency) })
    }
    return t('payment.rechargeBonus.creditedShort', { amount: '$' + quote.credited.toFixed(2) })
  }

  let placeholderText = t('payment.enterAmount')
  if (min > 0 && max > 0) placeholderText = `${min} - ${max}`
  else if (min > 0) placeholderText = `≥ ${min}`
  else if (max > 0) placeholderText = `≤ ${max}`

  function selectAmount(amt: number) {
    setCustomText(String(amt))
    onChange?.(amt)
  }

  function handleInput(val: string) {
    // 不合法的输入不更新状态，受控输入框保留上一次接受的文本
    if (!AMOUNT_PATTERN.test(val)) return
    setCustomText(val)
    if (val === '') {
      onChange?.(null)
      return
    }
    const num = parseFloat(val)
    if (!isNaN(num) && num > 0) {
      onChange?.(num)
    } else {
      onChange?.(null)
    }
  }

  return (
    <div className={styles.root}>
      {/* Quick Amount Buttons */}
      <div className={styles.section}>
        <span className={styles.label}>{t('payment.quickAmounts')}</span>
        <div className={styles.grid}>
          {filteredAmounts.map((amt) => {
            const quote = quoteFor(amt)
            const hit = quote.percent > 0
            return (
              <button
                key={amt}
                type="button"
                className={styles.amount}
                data-selected={value === amt ? '' : undefined}
                data-bonus={hit ? '' : undefined}
                aria-pressed={value === amt}
                data-testid={`quick-amount-${amt}`}
                onClick={() => selectAmount(amt)}
              >
                {/* 促销价签：仅命中档位的金额显示 */}
                {hit && (
                  <Badge tone="danger" size="sm" className={styles.badge} data-testid="quick-amount-bonus-badge">
                    {badgeText(amt)}
                  </Badge>
                )}
                <span className={styles.amountValue}>{amt}</span>
                {/* 配置了优惠阶梯时，所有按钮都显示第二行，保持高度一致：赠金显示到账 USD，折扣显示折后实付 */}
                {showSecondLine && (
                  <span className={styles.secondLine} data-bonus={hit ? '' : undefined} data-testid="quick-amount-credited">
                    {secondLine(amt)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom Amount Input */}
      <div className={styles.section}>
        <label className={styles.label} htmlFor={inputId}>
          {t('payment.customAmount')}
        </label>
        <Input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={customText}
          placeholder={placeholderText}
          prefix={<span className={styles.currencyPrefix}>$</span>}
          onChange={handleInput}
        />
      </div>
    </div>
  )
}
