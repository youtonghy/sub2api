import { BadgeCheck, CheckCircle2, Clock, DollarSign, Zap } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'

import { authAPI, redeemAPI, type RedeemHistoryItem } from '@/api'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { MetricCard } from '@/components/arc/metric-card/metric-card'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useSubscriptionStore } from '@/stores/subscriptions'
import { formatDateTime } from '@/utils/format'
import styles from './RedeemView.module.css'

interface RedeemResult {
  message: string
  type: string
  value: number
  new_balance?: number
  new_concurrency?: number
  group_name?: string
  validity_days?: number
}

type HistoryTone = 'success' | 'danger' | 'info' | 'warning' | 'accent'

const PAGE_SIZES = [20, 50, 100]

// Helper functions for history display
const isBalanceType = (type: string) => {
  return type === 'balance' || type === 'admin_balance'
}

const isSubscriptionType = (type: string) => {
  return type === 'subscription'
}

const isAdminAdjustment = (type: string) => {
  return type === 'admin_balance' || type === 'admin_concurrency'
}

/** 记录色调：余额增减绿/红、订阅强调色、并发增减蓝/橙（与 Vue 版配色语义一致） */
const historyTone = (item: RedeemHistoryItem): HistoryTone => {
  if (isBalanceType(item.type)) return item.value >= 0 ? 'success' : 'danger'
  if (isSubscriptionType(item.type)) return 'accent'
  return item.value >= 0 ? 'info' : 'warning'
}

/** 兑换码页面：当前余额、兑换表单、结果、说明与兑换记录 */
export default function RedeemView() {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)

  const [redeemCode, setRedeemCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [redeemResult, setRedeemResult] = useState<RedeemResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // History data
  const [history, setHistory] = useState<RedeemHistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(20)
  const historyPageSizeRef = useRef(20)
  const [historyTotal, setHistoryTotal] = useState(0)
  const historyRequest = useRef(0)
  const loadedHistoryPageSize = useRef(20)
  const [contactInfo, setContactInfo] = useState('')

  const updateHistoryPageSize = (size: number) => {
    historyPageSizeRef.current = size
    setHistoryPageSize(size)
  }

  const getHistoryItemTitle = (item: RedeemHistoryItem) => {
    if (item.type === 'balance') {
      return t('redeem.balanceAddedRedeem')
    } else if (item.type === 'admin_balance') {
      return item.value >= 0 ? t('redeem.balanceAddedAdmin') : t('redeem.balanceDeductedAdmin')
    } else if (item.type === 'concurrency') {
      return t('redeem.concurrencyAddedRedeem')
    } else if (item.type === 'admin_concurrency') {
      return item.value >= 0 ? t('redeem.concurrencyAddedAdmin') : t('redeem.concurrencyReducedAdmin')
    } else if (item.type === 'subscription') {
      return t('redeem.subscriptionAssigned')
    }
    return t('common.unknown')
  }

  const formatHistoryValue = (item: RedeemHistoryItem) => {
    if (isBalanceType(item.type)) {
      const sign = item.value >= 0 ? '+' : ''
      return `${sign}$${item.value.toFixed(2)}`
    } else if (isSubscriptionType(item.type)) {
      // 订阅类型显示有效天数和分组名称
      const days = item.validity_days || Math.round(item.value)
      const groupName = item.group?.name || ''
      return groupName ? `${days}${t('redeem.days')} - ${groupName}` : `${days}${t('redeem.days')}`
    } else {
      const sign = item.value >= 0 ? '+' : ''
      return `${sign}${item.value} ${t('redeem.requests')}`
    }
  }

  const fetchHistory = async (page = 1) => {
    const request = ++historyRequest.current
    const pageSize = historyPageSizeRef.current
    setLoadingHistory(true)
    try {
      const result = await redeemAPI.getHistory(page, pageSize)
      if (request !== historyRequest.current) return
      setHistory(result.items)
      setHistoryTotal(result.total)
      setHistoryPage(page)
      updateHistoryPageSize(pageSize)
      loadedHistoryPageSize.current = pageSize
    } catch (error) {
      if (request !== historyRequest.current) return
      updateHistoryPageSize(loadedHistoryPageSize.current)
      useAppStore.getState().showError(t('redeem.historyLoadFailed'))
      console.error('Failed to fetch history:', error)
    } finally {
      if (request === historyRequest.current) setLoadingHistory(false)
    }
  }

  const handleRedeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const appStore = useAppStore.getState()
    if (!redeemCode.trim()) {
      appStore.showError(t('redeem.pleaseEnterCode'))
      return
    }

    setSubmitting(true)
    setErrorMessage('')
    setRedeemResult(null)

    try {
      const result = await redeemAPI.redeem(redeemCode.trim())

      setRedeemResult(result)

      // Refresh user data to get updated balance/concurrency
      try {
        await useAuthStore.getState().refreshUser()
      } catch (error) {
        console.error('Failed to refresh user after redeem:', error)
        appStore.showWarning(t('redeem.userRefreshFailed'))
      }

      // If subscription type, immediately refresh subscription status
      if (result.type === 'subscription') {
        try {
          await useSubscriptionStore.getState().fetchActiveSubscriptions(true) // force refresh
        } catch (error) {
          console.error('Failed to refresh subscriptions after redeem:', error)
          appStore.showWarning(t('redeem.subscriptionRefreshFailed'))
        }
      }

      // Clear the input
      setRedeemCode('')

      // Refresh history
      await fetchHistory()

      // Show success toast
      appStore.showSuccess(t('redeem.codeRedeemSuccess'))
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail
      setErrorMessage(detail || t('redeem.failedToRedeem'))

      appStore.showError(t('redeem.redeemFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  useMountOnce(async () => {
    void fetchHistory()
    try {
      const settings = await authAPI.getPublicSettings()
      setContactInfo(settings.contact_info || '')
    } catch (error) {
      console.error('Failed to load contact info:', error)
    }
  })

  const historyIcon = (item: RedeemHistoryItem) => {
    // 余额类型图标 / 订阅类型图标 / 并发类型图标
    if (isBalanceType(item.type)) return <DollarSign size={18} strokeWidth={1.75} aria-hidden="true" />
    if (isSubscriptionType(item.type)) return <BadgeCheck size={18} strokeWidth={1.75} aria-hidden="true" />
    return <Zap size={18} strokeWidth={1.75} aria-hidden="true" />
  }

  const renderResultDetail = (result: RedeemResult) => (
    <div className={styles.result}>
      <p>{result.message}</p>
      <div className={styles.resultLines}>
        {result.type === 'balance' ? (
          <p className={styles.strong}>
            {t('redeem.added')}: ${result.value.toFixed(2)}
          </p>
        ) : result.type === 'concurrency' ? (
          <p className={styles.strong}>
            {t('redeem.added')}: {result.value} {t('redeem.concurrentRequests')}
          </p>
        ) : result.type === 'subscription' ? (
          <p className={styles.strong}>
            {t('redeem.subscriptionAssigned')}
            {result.group_name ? <span> - {result.group_name}</span> : null}
            {result.validity_days ? <span> ({t('redeem.subscriptionDays', { days: result.validity_days })})</span> : null}
          </p>
        ) : null}
        {result.new_balance !== undefined && (
          <p>
            {t('redeem.newBalance')}: <span className={styles.strong}>${result.new_balance.toFixed(2)}</span>
          </p>
        )}
        {result.new_concurrency !== undefined && (
          <p>
            {t('redeem.newConcurrency')}:{' '}
            <span className={styles.strong}>
              {result.new_concurrency} {t('redeem.requests')}
            </span>
          </p>
        )}
      </div>
    </div>
  )

  const renderHistory = () => {
    if (loadingHistory) return <Skeleton lines={4} label={t('common.loading')} />
    if (history.length > 0) {
      return (
        <ul className={styles.list}>
          {history.map((item) => (
            <li key={item.id} className={styles.row}>
              <span className={styles.rowIcon} data-tone={historyTone(item)}>
                {historyIcon(item)}
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{getHistoryItemTitle(item)}</span>
                <span className={styles.rowMeta}>{formatDateTime(item.used_at)}</span>
              </span>
              <span className={styles.rowEnd}>
                <span className={styles.rowValue} data-tone={historyTone(item)}>
                  {formatHistoryValue(item)}
                </span>
                {!isAdminAdjustment(item.type) ? (
                  <span className={styles.code}>{item.code.slice(0, 8)}...</span>
                ) : (
                  <span className={styles.rowMeta}>{t('redeem.adminAdjustment')}</span>
                )}
                {/* Display notes for admin adjustments */}
                {item.notes ? (
                  <span className={styles.notes} title={item.notes}>
                    {item.notes}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )
    }
    return (
      <div className={styles.historyEmpty}>
        <Clock size={24} strokeWidth={1.5} aria-hidden="true" />
        <p>{t('redeem.historyWillAppear')}</p>
      </div>
    )
  }

  const historyBusy = loadingHistory || submitting

  return (
    <div className={styles.page}>
      {/* Current Balance */}
      <MetricCard
        label={t('redeem.currentBalance')}
        prefix="$"
        value={Number(user?.balance?.toFixed(2) || '0.00')}
        decimals={2}
        context={`${t('redeem.concurrency')}: ${user?.concurrency || 0} ${t('redeem.requests')}`}
      />

      {/* Redeem Form */}
      <section className={styles.panel}>
        <form onSubmit={(event) => void handleRedeem(event)} className={styles.form}>
          <Input
            id="code"
            label={t('redeem.redeemCodeLabel')}
            description={t('redeem.redeemCodeHint')}
            type="text"
            required
            value={redeemCode}
            onChange={(event) => setRedeemCode(event.target.value)}
            placeholder={t('redeem.redeemCodePlaceholder')}
            disabled={submitting}
            autoComplete="off"
          />
          <Button type="submit" variant="primary" disabled={!redeemCode || submitting} loading={submitting} className={styles.submit}>
            {!submitting && <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden="true" />}
            {submitting ? t('redeem.redeeming') : t('redeem.redeemButton')}
          </Button>
        </form>
      </section>

      {/* Success Message */}
      {redeemResult && (
        <Alert tone="success" title={t('redeem.redeemSuccess')}>
          {renderResultDetail(redeemResult)}
        </Alert>
      )}

      {/* Error Message */}
      {errorMessage && (
        <Alert tone="danger" title={t('redeem.redeemFailed')}>
          {errorMessage}
        </Alert>
      )}

      {/* Information */}
      <Alert tone="info" title={t('redeem.aboutCodes')}>
        <ul className={styles.rules}>
          <li>{t('redeem.codeRule1')}</li>
          <li>{t('redeem.codeRule2')}</li>
          <li>
            {t('redeem.codeRule3')}
            {contactInfo ? (
              <Badge size="sm" className={styles.contact}>
                {contactInfo}
              </Badge>
            ) : null}
          </li>
          <li>{t('redeem.codeRule4')}</li>
        </ul>
      </Alert>

      {/* Recent Activity */}
      <section className={styles.panel} aria-labelledby="redeem-history" aria-busy={loadingHistory || undefined}>
        <h2 id="redeem-history" className={styles.title}>
          {t('redeem.recentActivity')}
        </h2>
        {renderHistory()}
        <div className={styles.pager}>
          <span>
            {t('common.total')}: {historyTotal} {t('pagination.results')}
          </span>
          <label className={styles.pageSize}>
            {t('pagination.perPage')}
            <select
              className={styles.select}
              value={historyPageSize}
              disabled={historyBusy}
              onChange={(event) => {
                updateHistoryPageSize(Number(event.target.value))
                void fetchHistory(1)
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.pagerButtons}>
            <Button
              variant="secondary"
              size="sm"
              disabled={historyBusy || historyPage <= 1}
              onClick={() => void fetchHistory(historyPage - 1)}
            >
              {t('pagination.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={historyBusy || historyPage * historyPageSize >= historyTotal}
              onClick={() => void fetchHistory(historyPage + 1)}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
