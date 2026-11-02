/**
 * 支付看板的展示工具：Vue 版在 OrderStatsCards / PaymentMethodChart / TopUsersLeaderboard /
 * AdminPaymentDashboardView 里各写了一份，这里合并为一处，行为不变。
 */
import type { CurrencyAmounts, TopUserPaymentStats } from '@/types/payment'

export function sortedAmounts(amounts: CurrencyAmounts): [string, number][] {
  return Object.entries(amounts).sort(([left], [right]) => left.localeCompare(right))
}

export function sortedTopUsers(usersByCurrency: Record<string, TopUserPaymentStats[]>): [string, TopUserPaymentStats[]][] {
  return Object.entries(usersByCurrency).sort(([left], [right]) => left.localeCompare(right))
}

export function hasTopUsers(usersByCurrency: Record<string, TopUserPaymentStats[]>): boolean {
  return Object.values(usersByCurrency).some((users) => users.length > 0)
}

export function formatMoney(currency: string, amount: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

/**
 * 把 formatMoney 的结果拆成 metric-card 需要的前缀、数值、小数位与后缀
 * （例如 "CN¥1,234.50" → prefix "CN¥"、value 1234.5、decimals 2）。
 */
export function splitMoney(currency: string, amount: number): { prefix: string; suffix: string; value: number; decimals: number } {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const parts = formatter.formatToParts(amount)
  const isNumberPart = (type: string) => type === 'integer' || type === 'group' || type === 'decimal' || type === 'fraction'
  const first = parts.findIndex((part) => isNumberPart(part.type))
  let last = -1
  parts.forEach((part, index) => {
    if (isNumberPart(part.type)) last = index
  })
  const prefix = parts
    .slice(0, Math.max(first, 0))
    .map((part) => part.value)
    .join('')
  const suffix = last >= 0 ? parts.slice(last + 1).map((part) => part.value).join('') : ''
  return {
    prefix,
    suffix,
    value: amount,
    decimals: formatter.resolvedOptions().maximumFractionDigits ?? 2
  }
}

/** 支付方式色点：Vue 版的蓝 / 绿 / 紫映射到分类色板 */
const METHOD_COLORS: Record<string, string> = {
  alipay: 'var(--chart-cat-1)',
  wxpay: 'var(--chart-cat-2)',
  alipay_direct: 'var(--chart-cat-11)',
  wxpay_direct: 'var(--chart-cat-10)',
  stripe: 'var(--chart-cat-5)'
}

export function methodColor(type: string): string {
  return METHOD_COLORS[type] || 'var(--text-muted)'
}
