/**
 * 国产厂商按量账号余额，对应 Vue 版 CNProviderBalanceCell.vue。
 */
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { CNProviderBalanceEntry, CNProviderBalanceResult } from '@/api/admin/cnProviders'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import { platformAccentColor } from '@/utils/platformColors'
import { cnBalanceCellVisible } from './credentialsBuilder'
import styles from './usageCells.module.css'

export interface CNProviderBalanceCellProps {
  account: Account
}

const formatEntry = (entry: CNProviderBalanceEntry): string => {
  const fixed = entry.balance >= 100 ? entry.balance.toFixed(0) : entry.balance.toFixed(2)
  return `${entry.currency || '¥'} ${fixed}`
}

/** 仅 kimi / deepseek payg 等有公开余额端点的账号可见；切换账号 id 时整体重建 */
export default function CNProviderBalanceCell(props: CNProviderBalanceCellProps) {
  if (!cnBalanceCellVisible(props.account)) return null
  return <CNProviderBalanceCellInner key={props.account.id} {...props} />
}

function CNProviderBalanceCellInner({ account }: CNProviderBalanceCellProps) {
  const { t } = useI18n()
  const [loading, setLoadingState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CNProviderBalanceResult | null>(null)
  const loadingRef = useRef(false)
  const disposed = useRef(false)

  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
    }
  }, [])

  const setLoading = (value: boolean) => {
    loadingRef.current = value
    setLoadingState(value)
  }

  const extra = account.extra as Record<string, unknown> | undefined
  const extraKey = (suffix: string) => `${account.platform}_${suffix}`

  // 落库快照（后端周期探测/响应式写入 account.Extra）。
  const snapshotBalanceRaw = extra?.[extraKey('balance')]
  const snapshotBalance = typeof snapshotBalanceRaw === 'number' ? snapshotBalanceRaw : null
  const snapshotCurrencyRaw = extra?.[extraKey('balance_currency')]
  const snapshotCurrency = typeof snapshotCurrencyRaw === 'string' ? snapshotCurrencyRaw : ''
  // 多币种快照（后端写 <platform>_balances：[{currency, balance}]，deepseek CNY+USD）。
  const snapshotBalances = (() => {
    const v = extra?.[extraKey('balances')]
    if (!Array.isArray(v)) return []
    return v.flatMap((item): CNProviderBalanceEntry[] => {
      if (!item || typeof item !== 'object') return []
      const { currency, balance } = item as Record<string, unknown>
      if (typeof currency !== 'string' || typeof balance !== 'number') return []
      return [{ currency, balance }]
    })
  })()
  const balanceLow = extra?.[extraKey('balance_low')] === true

  // 优先用探测结果，其次落库快照。多币种返回全部明细，否则主币种单条。
  const currentEntries = ((): CNProviderBalanceEntry[] => {
    if (data && data.success) {
      if (data.balances && data.balances.length > 0) return data.balances
      return [{ currency: data.currency || '', balance: data.balance }]
    }
    if (snapshotBalances.length > 0) return snapshotBalances
    if (snapshotBalance != null) return [{ currency: snapshotCurrency, balance: snapshotBalance }]
    return []
  })()

  // 修复:此前误引 admin.accounts.grokBalance(实际嵌套在 usageWindow 下),
  // 未命中时渲染原始 key。CN 供应商使用自己的占位键。
  const balanceLabel =
    currentEntries.length === 0 ? t('admin.accounts.cnProviders.balance') : currentEntries.map(formatEntry).join(' · ')

  const extractErrorMessage = (e: unknown): string => {
    const err = e as {
      message?: string
      reason?: string
      response?: { data?: { message?: string; error?: string } }
    }
    return (
      err?.message || err?.reason || err?.response?.data?.message || err?.response?.data?.error || t('common.error')
    )
  }

  const truncatedError = error ? (error.length > 80 ? `${error.slice(0, 80)}...` : error) : ''

  const handleProbe = async () => {
    if (loadingRef.current) return
    setLoading(true)
    setError(null)
    try {
      const result = await adminAPI.cnProviders.queryBalance(account.id)
      if (disposed.current) return
      // 失败时保留快照展示（仅显示错误行），成功才覆盖。
      if (result.success) {
        setData(result)
      } else {
        setError(result.error || t('common.error'))
      }
    } catch (e) {
      if (!disposed.current) setError(extractErrorMessage(e))
    } finally {
      if (!disposed.current) setLoading(false)
    }
  }

  return (
    <div className={styles.stack}>
      {/* Balance value row: static display (snapshot or probe result) */}
      <div className={styles.actionsRow}>
        <span
          data-test="cn-provider-balance-value"
          className={styles.mutedLine}
          style={{ color: platformAccentColor(account.platform), fontWeight: 500, lineHeight: '16px' }}
          title={t('admin.accounts.cnProviders.balanceProbeTooltip')}
        >
          {balanceLabel}
        </span>

        {/* Low balance badge (reactive 402/429 marker or probe-detected) */}
        {balanceLow ? (
          <span className={styles.tag} data-tone="danger">
            {t('admin.accounts.cnProviders.balanceLow')}
          </span>
        ) : null}
      </div>

      {/* Explicit refresh action (aligned with the OpenAI "Query" / Grok "Probe"
          buttons): the old chip doubled as the data display and a hidden click
          target, which users could not discover. The verb label makes the
          affordance explicit. */}
      <div className={styles.actionsRow}>
        <button
          type="button"
          data-test="cn-provider-balance-probe"
          className={styles.action}
          disabled={loading}
          title={t('admin.accounts.cnProviders.balanceProbeTooltip')}
          onClick={() => void handleProbe()}
        >
          <RefreshCw className={[styles.actionIcon, loading ? styles.spin : ''].join(' ')} aria-hidden="true" />
          {t('admin.accounts.cnProviders.probe')}
        </button>
      </div>

      {error ? (
        <div className={styles.errorTiny} title={error}>
          {truncatedError}
        </div>
      ) : null}
    </div>
  )
}
