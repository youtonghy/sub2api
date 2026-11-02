/**
 * 国产厂商 coding plan / 订阅额度窗口，对应 Vue 版 CNProviderQuotaCell.vue。
 */
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminAPI } from '@/api/admin'
import type { CNProviderQuotaProbeResult } from '@/api/admin/cnProviders'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import { cnQuotaCellVisible } from './credentialsBuilder'
import UsageProgressBar from './UsageProgressBar'
import styles from './usageCells.module.css'
import local from './CNProviderQuotaCell.module.css'

export interface CNProviderQuotaCellProps {
  account: Account
}

// 后端周期任务/手动探测写入的 extra 快照键（<provider>_ 前缀，与后端
// cnQuotaExtraUpdates 对齐）。页面加载即有数据，无需等待探测。
const SNAPSHOT_STALE_MS = 15 * 60 * 1000

// 自动探测去抖窗口与最近一次自动探测时间（模块级，跨实例共享）。
const AUTO_PROBE_DEBOUNCE_MS = 5 * 60 * 1000
const lastAutoProbeAt = new Map<number, number>()

const readExtraNumber = (account: Account, key: string): number | null => {
  const v = (account.extra as Record<string, unknown> | undefined)?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const readExtraString = (account: Account, key: string): string => {
  const v = (account.extra as Record<string, unknown> | undefined)?.[key]
  return typeof v === 'string' ? v : ''
}

// 从持久化快照构造展示数据（缺少 5h/weekly 两档键时返回 null）。
const snapshotData = (account: Account): CNProviderQuotaProbeResult | null => {
  const platform = account.platform
  const used5h = readExtraNumber(account, `${platform}_5h_used_percent`)
  const usedWeekly = readExtraNumber(account, `${platform}_weekly_used_percent`)
  const usedMonthly = readExtraNumber(account, `${platform}_monthly_used_percent`)
  if (used5h == null && usedWeekly == null && usedMonthly == null) return null
  const tiers: CNProviderQuotaProbeResult['tiers'] = []
  if (used5h != null) {
    tiers.push({ window: '5h', used_percent: used5h, reset_at: readExtraString(account, `${platform}_5h_reset_at`) || undefined })
  }
  if (usedWeekly != null) {
    tiers.push({
      window: 'weekly',
      used_percent: usedWeekly,
      reset_at: readExtraString(account, `${platform}_weekly_reset_at`) || undefined
    })
  }
  if (usedMonthly != null) {
    tiers.push({
      window: 'monthly',
      used_percent: usedMonthly,
      reset_at: readExtraString(account, `${platform}_monthly_reset_at`) || undefined
    })
  }
  return { success: true, tiers } as CNProviderQuotaProbeResult
}

// 快照是否过期（无更新时间或超过 staleness 窗口）→ 挂载时需要自动探测。
const snapshotIsStale = (account: Account): boolean => {
  const updatedAt = readExtraString(account, `${account.platform}_usage_updated_at`)
  if (!updatedAt) return true
  const ts = new Date(updatedAt).getTime()
  return Number.isNaN(ts) || Date.now() - ts > SNAPSHOT_STALE_MS
}

// 模块级去抖：列表页每行一个实例，翻页/筛选/刷新会重复挂载；同一账号
// 短时间内已自动探测过则跳过，避免对上游形成探测风暴。
const claimAutoProbe = (accountID: number): boolean => {
  const last = lastAutoProbeAt.get(accountID) ?? 0
  if (Date.now() - last < AUTO_PROBE_DEBOUNCE_MS) return false
  lastAutoProbeAt.set(accountID, Date.now())
  return true
}

/** 切换账号 id 时整体重建（Vue 版 watch(account.id) 清空结果） */
export default function CNProviderQuotaCell(props: CNProviderQuotaCellProps) {
  if (!cnQuotaCellVisible(props.account)) return null
  return <CNProviderQuotaCellInner key={props.account.id} {...props} />
}

function CNProviderQuotaCellInner({ account }: CNProviderQuotaCellProps) {
  const { t } = useI18n()
  // 挂载时：先用持久化快照渲染
  const [data, setData] = useState<CNProviderQuotaProbeResult | null>(() => snapshotData(account))
  const [loading, setLoadingState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)
  const disposed = useRef(false)

  const setLoading = (value: boolean) => {
    loadingRef.current = value
    setLoadingState(value)
  }

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

  const handleProbe = async () => {
    if (loadingRef.current) return
    setLoading(true)
    setError(null)
    try {
      const result = await adminAPI.cnProviders.queryQuota(account.id)
      if (disposed.current) return
      // 失败时保留已渲染的快照条形图（仅显示错误行），成功才覆盖。
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

  const probeRef = useRef(handleProbe)
  useEffect(() => {
    probeRef.current = handleProbe
  })

  // 快照缺失或过期再自动探测一次（失败显示错误，避免静默失败导致单元格空白无提示）。
  const accountRef = useRef(account)
  useEffect(() => {
    disposed.current = false
    const current = accountRef.current
    if (snapshotIsStale(current) && claimAutoProbe(current.id)) void probeRef.current()
    return () => {
      disposed.current = true
    }
  }, [])

  const truncatedError = error ? (error.length > 80 ? `${error.slice(0, 80)}...` : error) : ''

  const windowLabel = (window: string) => {
    if (window === 'weekly') return t('admin.accounts.cnProviders.windowWeekly')
    if (window === 'monthly') return t('admin.accounts.cnProviders.windowMonthly')
    return t('admin.accounts.cnProviders.window5h')
  }

  return (
    <div data-test="cn-provider-quota" className={local.root}>
      {/* Tier rows: 5h + weekly utilization bars (snapshot renders on mount).
          复用账号页 UsageProgressBar：同阈值配色、同倒计时格式。 */}
      {data?.success && data.tiers?.length ? (
        <div className={styles.stack}>
          {data.tiers.map((tier) => (
            <UsageProgressBar
              key={tier.window}
              data-test="cn-provider-quota-tier"
              label={windowLabel(tier.window)}
              color={tier.window === 'weekly' ? 'emerald' : 'indigo'}
              utilization={tier.used_percent}
              resetsAt={tier.reset_at}
            />
          ))}
        </div>
      ) : null}

      {/* Explicit refresh action (aligned with the OpenAI "Query" / Grok "Probe"
          buttons): a verb label tells users this chip is clickable. The previous
          noun label ("5h/weekly") read as a passive caption and users could not
          discover the manual refresh. */}
      <div className={styles.actionsRow}>
        <button
          type="button"
          data-test="cn-provider-quota-probe"
          className={styles.action}
          disabled={loading}
          title={t('admin.accounts.cnProviders.probeTooltip')}
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
