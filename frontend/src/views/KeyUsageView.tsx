/**
 * 公开的 API 密钥用量查询页，对应 Vue 版 KeyUsageView.vue（无布局，自带页头页脚）。
 * 直接以 Bearer 密钥请求网关 /v1/usage，密钥不经过本站后端存储。
 */
import {
  BookOpen,
  Calendar,
  Check,
  Clock,
  DollarSign,
  Eye,
  EyeOff,
  Lock,
  Moon,
  Search,
  Shield,
  Sun
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { buildGatewayUrl } from '@/api/url'
import Input from '@/components/common/Input'
import LocaleSwitcher from '@/components/common/LocaleSwitcher'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useTheme } from '@/theme/useTheme'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'
import { formatDateLocalInput } from '@/utils/format'
import { sanitizeUrl } from '@/utils/url'
import styles from './KeyUsageView.module.css'

type DateRangeKey = 'today' | '7d' | '30d' | 'custom'
type DailyUsageDays = 7 | 30 | 90

const CIRCUMFERENCE = 2 * Math.PI * 68
// 环形图颜色：Vue 版为固定渐变，这里换成随明暗主题变化的分类色
const RING_COLORS = ['var(--chart-cat-1)', 'var(--chart-cat-2)', 'var(--chart-cat-3)', 'var(--chart-cat-4)']

interface RingItem {
  title: string
  pct: number
  amount: string
  isBalance?: boolean
  iconType: 'clock' | 'calendar' | 'dollar'
  resetAt?: string | null
}

type Tone = 'success' | 'warning' | 'danger' | ''
type DetailIcon = 'shield' | 'calendar' | 'dollar' | 'check'

interface DetailRow {
  icon: DetailIcon
  label: string
  value: string
  tone: Tone
}

interface StatCell {
  label: string
  value: string
}

interface DailyUsageRow {
  date: string
  requests: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost: number
  actual_cost?: number
}

// ==================== Utility Functions ====================

function usd(value: number | null | undefined): string {
  if (value == null || value < 0) return '-'
  return '$' + Number(value).toFixed(2)
}

function fmtNum(val: number | null | undefined): string {
  if (val == null) return '-'
  return val.toLocaleString()
}

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function getUsageTone(pct: number): Tone {
  if (pct > 90) return 'danger'
  if (pct > 70) return 'warning'
  return 'success'
}

const detailIcons: Record<DetailIcon, ReactNode> = {
  shield: <Shield size={16} aria-hidden="true" />,
  calendar: <Calendar size={16} aria-hidden="true" />,
  dollar: <DollarSign size={16} aria-hidden="true" />,
  check: <Check size={16} aria-hidden="true" />
}

const ringIcons: Record<RingItem['iconType'], ReactNode> = {
  clock: <Clock size={18} aria-hidden="true" />,
  calendar: <Calendar size={18} aria-hidden="true" />,
  dollar: <DollarSign size={18} aria-hidden="true" />
}

export default function KeyUsageView() {
  const { t, locale } = useI18n()
  const cachedPublicSettings = useAppStore((s) => s.cachedPublicSettings)
  const storeSiteName = useAppStore((s) => s.siteName)
  const storeSiteLogo = useAppStore((s) => s.siteLogo)
  const storeDocUrl = useAppStore((s) => s.docUrl)
  const { isDark, toggleTheme } = useTheme()

  const subscriptionFeatureEnabled = resolveFeatureFlag(cachedPublicSettings, FeatureFlags.subscription)

  // ==================== Site Settings (same as HomeView) ====================
  const siteName = cachedPublicSettings?.site_name || storeSiteName || 'RetooAi'
  const siteLogo = sanitizeUrl(cachedPublicSettings?.site_logo || storeSiteLogo || '', { allowRelative: true, allowDataUrl: true })
  const docUrl = sanitizeUrl(cachedPublicSettings?.doc_url || storeDocUrl || '')
  const currentYear = new Date().getFullYear()

  // ==================== Key Query State ====================
  const [apiKey, setApiKey] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [isQuerying, setIsQuerying] = useState(false)
  const isQueryingRef = useRef(false)
  const [showResults, setShowResults] = useState(false)
  const [showLoading, setShowLoading] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [resultData, setResultData] = useState<any>(null)
  const [now, setNow] = useState(() => new Date())

  // ==================== Date Range State ====================
  const [currentRange, setCurrentRange] = useState<DateRangeKey>('today')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [dailyUsageDays, setDailyUsageDaysState] = useState<DailyUsageDays>(30)

  // ==================== Ring Animation ====================
  const [ringAnimated, setRingAnimated] = useState(false)
  const [displayPcts, setDisplayPcts] = useState<number[]>([])
  const animationTimers = useRef<{ timeout?: ReturnType<typeof setTimeout>; frame?: number }>({})

  const dateRanges = [
    { value: 'today', label: t('keyUsage.dateRangeToday') },
    { value: '7d', label: t('keyUsage.dateRange7d') },
    { value: '30d', label: t('keyUsage.dateRange30d') },
    { value: 'custom', label: t('keyUsage.dateRangeCustom') }
  ]

  const dailyUsageOptions = [
    { value: '7', label: t('keyUsage.dateRange7d') },
    { value: '30', label: t('keyUsage.dateRange30d') },
    { value: '90', label: t('keyUsage.dateRange90d') }
  ]

  useEffect(() => {
    // 与 Vue 版一致：公开设置未加载时补一次请求
    const appStore = useAppStore.getState()
    if (!appStore.publicSettingsLoaded) {
      void appStore.fetchPublicSettings()
    }
    const resetTimer = setInterval(() => { setNow(new Date()) }, 60000)
    const timers = animationTimers.current
    return () => {
      clearInterval(resetTimer)
      if (timers.timeout) clearTimeout(timers.timeout)
      if (timers.frame) cancelAnimationFrame(timers.frame)
    }
  }, [])

  function formatResetTime(resetAt: string | null | undefined): string {
    if (!resetAt) return ''
    const diff = new Date(resetAt).getTime() - now.getTime()
    if (diff <= 0) return t('keyUsage.resetNow')
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    const mins = Math.floor((diff % 3600000) / 60000)
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '-'
    const d = new Date(iso)
    const loc = locale === 'zh' ? 'zh-CN' : 'en-US'
    return d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' })
  }

  // ==================== Computed Data ====================
  const buildRingItems = (data: any): RingItem[] => {
    if (!data) return []
    const items: RingItem[] = []

    if (data.mode === 'quota_limited') {
      if (data.quota) {
        const pct = data.quota.limit > 0 ? Math.min(Math.round((data.quota.used / data.quota.limit) * 100), 100) : 0
        items.push({ title: t('keyUsage.totalQuota'), pct, amount: `${usd(data.quota.used)} / ${usd(data.quota.limit)}`, iconType: 'dollar' })
      }
      if (data.rate_limits) {
        const windowLabels: Record<string, string> = { '5h': t('keyUsage.limit5h'), '1d': t('keyUsage.limitDaily'), '7d': t('keyUsage.limit7d') }
        const windowIcons: Record<string, 'clock' | 'calendar'> = { '5h': 'clock', '1d': 'calendar', '7d': 'calendar' }
        for (const rl of data.rate_limits) {
          const pct = rl.limit > 0 ? Math.min(Math.round((rl.used / rl.limit) * 100), 100) : 0
          items.push({
            title: windowLabels[rl.window] || rl.window,
            pct,
            amount: `${usd(rl.used)} / ${usd(rl.limit)}`,
            iconType: windowIcons[rl.window] || 'clock',
            resetAt: rl.reset_at
          })
        }
      }
    } else {
      if (data.subscription) {
        const sub = data.subscription
        const limits = [
          { label: t('keyUsage.limitDaily'), usage: sub.daily_usage_usd, limit: sub.daily_limit_usd },
          { label: t('keyUsage.limitWeekly'), usage: sub.weekly_usage_usd, limit: sub.weekly_limit_usd },
          { label: t('keyUsage.limitMonthly'), usage: sub.monthly_usage_usd, limit: sub.monthly_limit_usd }
        ]
        for (const l of limits) {
          if (l.limit != null && l.limit > 0) {
            const pct = Math.min(Math.round((l.usage / l.limit) * 100), 100)
            items.push({ title: l.label, pct, amount: `${usd(l.usage)} / ${usd(l.limit)}`, iconType: 'calendar' })
          }
        }
      }
      if (!data.subscription && data.balance != null) {
        items.push({ title: t('keyUsage.walletBalance'), pct: 0, amount: usd(data.balance), isBalance: true, iconType: 'dollar' })
      }
    }

    return items
  }

  const statusInfo = (() => {
    const data = resultData
    if (!data) return null

    if (data.mode === 'quota_limited') {
      const isValid = data.isValid !== false
      const statusMap: Record<string, string> = {
        active: 'Active',
        quota_exhausted: 'Quota Exhausted',
        expired: 'Expired'
      }
      return {
        label: t('keyUsage.quotaMode'),
        statusText: statusMap[data.status] || data.status || 'Unknown',
        isActive: isValid && data.status === 'active'
      }
    }

    return {
      label: data.planName || t('keyUsage.walletBalance'),
      statusText: 'Active',
      isActive: true
    }
  })()

  const ringItems = buildRingItems(resultData)

  const detailRows = ((): DetailRow[] => {
    const data = resultData
    if (!data) return []
    const rows: DetailRow[] = []

    if (data.mode === 'quota_limited') {
      if (data.quota) {
        const remainTone: Tone = data.quota.remaining <= 0 ? 'danger'
          : data.quota.remaining < data.quota.limit * 0.1 ? 'warning'
            : 'success'
        rows.push({ icon: 'shield', label: t('keyUsage.remainingQuota'), value: usd(data.quota.remaining), tone: remainTone })
      }
      if (data.expires_at) {
        const daysLeft = data.days_until_expiry
        let expiryStr = formatDate(data.expires_at)
        if (daysLeft != null) {
          expiryStr += daysLeft > 0 ? ` ${t('keyUsage.daysLeft', { days: daysLeft })}` : daysLeft === 0 ? ` ${t('keyUsage.todayExpires')}` : ''
        }
        rows.push({ icon: 'calendar', label: t('keyUsage.expiresAt'), value: expiryStr, tone: '' })
      }
      if (data.rate_limits) {
        const windowMap: Record<string, string> = { '5h': '5H', '1d': locale === 'zh' ? '日' : 'D', '7d': '7D' }
        for (const rl of data.rate_limits) {
          const pct = rl.limit > 0 ? (rl.used / rl.limit) * 100 : 0
          let valueStr = `${usd(rl.used)} / ${usd(rl.limit)}`
          const resetStr = formatResetTime(rl.reset_at)
          if (resetStr) {
            valueStr += ` (⟳ ${resetStr})`
          }
          rows.push({
            icon: 'dollar',
            label: `${t('keyUsage.usedQuota')} (${windowMap[rl.window] || rl.window})`,
            value: valueStr,
            tone: getUsageTone(pct)
          })
        }
      }
    } else {
      rows.push({
        icon: 'check',
        // 订阅功能关闭后这一行只会是「钱包余额」，标签改用不带「订阅」字样的「计费方式」。
        label: subscriptionFeatureEnabled ? t('keyUsage.subscriptionType') : t('keyUsage.billingType'),
        value: data.planName || t('keyUsage.walletBalance'),
        tone: ''
      })

      if (data.subscription) {
        const sub = data.subscription
        if (sub.daily_limit_usd > 0) {
          const pct = (sub.daily_usage_usd / sub.daily_limit_usd) * 100
          rows.push({
            icon: 'dollar',
            label: `${t('keyUsage.usedQuota')} (${locale === 'zh' ? '日' : 'D'})`,
            value: `${usd(sub.daily_usage_usd)} / ${usd(sub.daily_limit_usd)}`,
            tone: getUsageTone(pct)
          })
        }
        if (sub.weekly_limit_usd > 0) {
          const pct = (sub.weekly_usage_usd / sub.weekly_limit_usd) * 100
          rows.push({
            icon: 'dollar',
            label: `${t('keyUsage.usedQuota')} (${locale === 'zh' ? '周' : 'W'})`,
            value: `${usd(sub.weekly_usage_usd)} / ${usd(sub.weekly_limit_usd)}`,
            tone: getUsageTone(pct)
          })
        }
        if (sub.monthly_limit_usd > 0) {
          const pct = (sub.monthly_usage_usd / sub.monthly_limit_usd) * 100
          rows.push({
            icon: 'dollar',
            label: `${t('keyUsage.usedQuota')} (${locale === 'zh' ? '月' : 'M'})`,
            value: `${usd(sub.monthly_usage_usd)} / ${usd(sub.monthly_limit_usd)}`,
            tone: getUsageTone(pct)
          })
        }
        if (sub.expires_at) {
          rows.push({ icon: 'calendar', label: t('keyUsage.subscriptionExpires'), value: formatDate(sub.expires_at), tone: '' })
        }
      }

      const remainTone: Tone = data.remaining != null
        ? (data.remaining <= 0 ? 'danger' : data.remaining < 10 ? 'warning' : 'success')
        : ''
      rows.push({
        icon: 'shield',
        label: t('keyUsage.remainingQuota'),
        value: data.remaining != null ? usd(data.remaining) : '-',
        tone: remainTone
      })
    }

    return rows
  })()

  const usageStatCells = ((): StatCell[] => {
    const usage = resultData?.usage
    if (!usage) return []
    const today = usage.today || {}
    const total = usage.total || {}
    return [
      { label: t('keyUsage.todayRequests'), value: fmtNum(today.requests) },
      { label: t('keyUsage.todayInputTokens'), value: fmtNum(today.input_tokens) },
      { label: t('keyUsage.todayOutputTokens'), value: fmtNum(today.output_tokens) },
      { label: t('keyUsage.todayTokens'), value: fmtNum(today.total_tokens) },
      { label: t('keyUsage.todayCacheCreation'), value: fmtNum(today.cache_creation_tokens) },
      { label: t('keyUsage.todayCacheRead'), value: fmtNum(today.cache_read_tokens) },
      { label: t('keyUsage.todayCost'), value: usd(today.actual_cost) },
      { label: t('keyUsage.rpmTpm'), value: `${usage.rpm || 0} / ${usage.tpm || 0}` },
      { label: t('keyUsage.totalRequests'), value: fmtNum(total.requests) },
      { label: t('keyUsage.totalInputTokens'), value: fmtNum(total.input_tokens) },
      { label: t('keyUsage.totalOutputTokens'), value: fmtNum(total.output_tokens) },
      { label: t('keyUsage.totalTokensLabel'), value: fmtNum(total.total_tokens) },
      { label: t('keyUsage.totalCacheCreation'), value: fmtNum(total.cache_creation_tokens) },
      { label: t('keyUsage.totalCacheRead'), value: fmtNum(total.cache_read_tokens) },
      { label: t('keyUsage.totalCost'), value: usd(total.actual_cost) },
      { label: t('keyUsage.avgDuration'), value: usage.average_duration_ms ? `${Math.round(usage.average_duration_ms)} ms` : '-' }
    ]
  })()

  const modelStats: any[] = resultData?.model_stats || []
  const dailyUsageRows: DailyUsageRow[] = Array.isArray(resultData?.daily_usage) ? resultData.daily_usage : []
  const showDailyUsage = Boolean(resultData && Array.isArray(resultData.daily_usage))

  function getRingOffset(ring: RingItem): number {
    if (!ringAnimated) return CIRCUMFERENCE
    if (ring.isBalance) return 0
    return CIRCUMFERENCE - (Math.min(ring.pct, 100) / 100) * CIRCUMFERENCE
  }

  function triggerRingAnimation(items: RingItem[]) {
    const timers = animationTimers.current
    if (timers.timeout) clearTimeout(timers.timeout)
    if (timers.frame) cancelAnimationFrame(timers.frame)
    setRingAnimated(false)
    setDisplayPcts(items.map(() => 0))

    timers.frame = requestAnimationFrame(() => {
      timers.timeout = setTimeout(() => {
        setRingAnimated(true)

        // Animate percentage numbers
        const duration = 1000
        const startTime = performance.now()
        const targets = items.map((item) => (item.isBalance ? 0 : item.pct))

        function tick() {
          const elapsed = performance.now() - startTime
          const p = Math.min(elapsed / duration, 1)
          const ease = 1 - Math.pow(1 - p, 3)
          setDisplayPcts(targets.map((target) => Math.round(ease * target)))
          if (p < 1) timers.frame = requestAnimationFrame(tick)
        }
        timers.frame = requestAnimationFrame(tick)
      }, 50)
    })
  }

  // ==================== API Query ====================
  function getDateParams(range: DateRangeKey, days: DailyUsageDays): string {
    const current = new Date()
    const params = new URLSearchParams()

    if (range === 'custom') {
      if (customStartDate && customEndDate) {
        params.set('start_date', customStartDate)
        params.set('end_date', customEndDate)
      }
    } else {
      const end = formatDateLocalInput(current)
      let start: string
      switch (range) {
        case 'today': start = end; break
        case '7d': start = formatDateLocalInput(new Date(current.getTime() - 7 * 86400000)); break
        case '30d': start = formatDateLocalInput(new Date(current.getTime() - 30 * 86400000)); break
        default: start = formatDateLocalInput(new Date(current.getTime() - 30 * 86400000))
      }
      params.set('start_date', start)
      params.set('end_date', end)
    }
    params.set('days', String(days))
    params.set('timezone', getBrowserTimezone())
    return params.toString()
  }

  async function fetchUsage(key: string, range: DateRangeKey, days: DailyUsageDays) {
    const dateParams = getDateParams(range, days)
    const url = buildGatewayUrl('/v1/usage') + (dateParams ? '?' + dateParams : '')
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + key }
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const msg = body?.error?.message || body?.message || `${t('keyUsage.queryFailed')} (${res.status})`
      throw new Error(msg)
    }
    return await res.json()
  }

  // range / days 参数让切换范围后立即以新值查询（Vue 版在同一 tick 内读取已更新的 ref）
  async function queryKey(range: DateRangeKey = currentRange, days: DailyUsageDays = dailyUsageDays) {
    if (isQueryingRef.current) return
    const appStore = useAppStore.getState()
    const key = apiKey.trim()
    if (!key) {
      appStore.showInfo(t('keyUsage.enterApiKey'))
      return
    }

    isQueryingRef.current = true
    setIsQuerying(true)
    setShowResults(true)
    setShowLoading(true)
    setResultData(null)

    try {
      const data = await fetchUsage(key, range, days)
      setResultData(data)
      setShowLoading(false)
      setShowDatePicker(true)

      // Trigger ring animations after DOM update
      triggerRingAnimation(buildRingItems(data))

      appStore.showSuccess(t('keyUsage.querySuccess'))
    } catch (err) {
      setShowResults(false)
      setShowLoading(false)
      appStore.showError((err as Error).message || t('keyUsage.queryFailedRetry'))
    } finally {
      isQueryingRef.current = false
      setIsQuerying(false)
    }
  }

  function setDateRange(key: DateRangeKey) {
    setCurrentRange(key)
    if (key !== 'custom') {
      void queryKey(key)
    }
  }

  function setDailyUsageDays(days: DailyUsageDays) {
    if (dailyUsageDays === days) return
    setDailyUsageDaysState(days)
    if (resultData && apiKey.trim()) {
      void queryKey(currentRange, days)
    }
  }

  const ringGridClass = ringItems.length === 1
    ? styles.ringGridSingle
    : ringItems.length === 2 ? styles.ringGridDouble : styles.ringGridTriple

  return (
    <div className={styles.page}>
      {/* Header (same pattern as HomeView) */}
      <header className={styles.header}>
        <nav className={styles.nav}>
          <Link to="/home" className={styles.brand}>
            <span className={styles.logo}>
              <img src={siteLogo || '/logo.svg'} alt="Logo" />
            </span>
            <span className={styles.siteName}>{siteName}</span>
          </Link>
          <div className={styles.headerActions}>
            <LocaleSwitcher />
            {docUrl && (
              <a
                href={docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.iconLink}
                title={t('home.viewDocs')}
                aria-label={t('home.viewDocs')}
              >
                <BookOpen size={20} aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              className={styles.iconLink}
              title={isDark ? t('home.switchToLight') : t('home.switchToDark')}
              aria-label={isDark ? t('home.switchToLight') : t('home.switchToDark')}
              onClick={toggleTheme}
            >
              {isDark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
            </button>
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.title}>{t('keyUsage.title')}</h1>
          <p className={styles.subtitle}>{t('keyUsage.subtitle')}</p>
        </div>

        {/* Input Section */}
        <div className={styles.querySection}>
          <div className={styles.queryRow}>
            <div className={styles.keyInput}>
              <Input
                value={apiKey}
                onChange={setApiKey}
                type={keyVisible ? 'text' : 'password'}
                placeholder={t('keyUsage.placeholder')}
                aria-label={t('keyUsage.placeholder')}
                autoComplete="off"
                prefix={<Lock size={16} aria-hidden="true" />}
                suffix={
                  <button
                    type="button"
                    className={styles.visibilityToggle}
                    aria-label={keyVisible ? t('authUi.hidePassword') : t('authUi.showPassword')}
                    onClick={() => setKeyVisible((visible) => !visible)}
                  >
                    {keyVisible ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
                  </button>
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void queryKey()
                }}
              />
            </div>
            <Button type="button" loading={isQuerying} disabled={isQuerying} onClick={() => void queryKey()}>
              {!isQuerying && <Search size={16} aria-hidden="true" />}
              {isQuerying ? t('keyUsage.querying') : t('keyUsage.query')}
            </Button>
          </div>
          <p className={styles.privacyNote}>{t('keyUsage.privacyNote')}</p>

          {/* Date Range Picker */}
          {showDatePicker && (
            <div className={styles.dateRange}>
              <span className={styles.dateRangeLabel}>{t('keyUsage.dateRange')}</span>
              <SegmentedControl
                options={dateRanges}
                value={currentRange}
                label={t('keyUsage.dateRange')}
                onValueChange={(value) => setDateRange(value as DateRangeKey)}
              />
              {currentRange === 'custom' && (
                <div className={styles.customRange}>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={customStartDate}
                    onChange={(event) => setCustomStartDate(event.target.value)}
                  />
                  <span className={styles.muted}>-</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={customEndDate}
                    onChange={(event) => setCustomEndDate(event.target.value)}
                  />
                  <Button type="button" size="sm" onClick={() => void queryKey()}>
                    {t('keyUsage.apply')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Results Container */}
        {showResults && (
          showLoading ? (
            <div className={styles.results}>
              <div className={styles.ringGridDouble}>
                <div className={`${styles.region} ${styles.padded}`}><Skeleton lines={4} /></div>
                <div className={`${styles.region} ${styles.padded}`}><Skeleton lines={4} /></div>
              </div>
              <div className={`${styles.region} ${styles.padded}`}><Skeleton lines={4} /></div>
            </div>
          ) : resultData ? (
            <div className={styles.results}>
              {/* Status Badge */}
              {statusInfo && (
                <div className={styles.statusRow}>
                  <div className={styles.statusPill}>
                    <span className={styles.statusDot} data-active={statusInfo.isActive} />
                    <span className={styles.statusLabel}>{statusInfo.label}</span>
                    <span className={styles.muted}>|</span>
                    <span className={styles.statusText}>{statusInfo.statusText}</span>
                  </div>
                </div>
              )}

              {/* Ring Cards Grid */}
              {ringItems.length > 0 && (
                <div className={ringGridClass}>
                  {ringItems.map((ring, i) => (
                    <section key={i} className={styles.ringCard}>
                      <div className={styles.ringHeader}>
                        <h2 className={styles.sectionTitle}>{ring.title}</h2>
                        <span className={styles.muted}>{ringIcons[ring.iconType]}</span>
                      </div>
                      <div className={styles.ringWrap}>
                        <svg className={styles.ring} viewBox="0 0 160 160" aria-hidden="true">
                          <circle cx="80" cy="80" r="68" fill="none" className={styles.ringTrack} strokeWidth="10" />
                          <circle
                            className={styles.progressRing}
                            cx="80"
                            cy="80"
                            r="68"
                            fill="none"
                            stroke={RING_COLORS[i % 4]}
                            strokeWidth="10"
                            strokeLinecap="round"
                            strokeDasharray={CIRCUMFERENCE.toFixed(2)}
                            strokeDashoffset={getRingOffset(ring)}
                          />
                        </svg>
                        <div className={styles.ringCenter}>
                          {ring.isBalance ? (
                            <span className={styles.ringBalance} style={{ color: RING_COLORS[i % 4] }}>{ring.amount}</span>
                          ) : (
                            <>
                              <span className={styles.ringPct}>{displayPcts[i] ?? 0}%</span>
                              <span className={styles.ringUsed}>{t('keyUsage.used')}</span>
                              <span className={styles.ringAmount} style={{ color: RING_COLORS[i % 4] }}>{ring.amount}</span>
                              {ring.resetAt && formatResetTime(ring.resetAt) && (
                                <p className={styles.ringReset}>⟳ {formatResetTime(ring.resetAt)}</p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              )}

              {/* Detail Card */}
              {detailRows.length > 0 && (
                <section className={styles.region}>
                  <div className={styles.regionHeader}>
                    <h2 className={styles.sectionTitle}>{t('keyUsage.detailInfo')}</h2>
                  </div>
                  <div className={styles.detailList}>
                    {detailRows.map((row, i) => (
                      <div key={i} className={styles.detailRow}>
                        <div className={styles.detailLabel}>
                          <span className={styles.detailIcon}>{detailIcons[row.icon]}</span>
                          <span>{row.label}</span>
                        </div>
                        <span className={styles.detailValue} data-tone={row.tone || undefined}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Usage Stats Card */}
              {usageStatCells.length > 0 && (
                <section className={styles.region}>
                  <div className={styles.regionHeader}>
                    <h2 className={styles.sectionTitle}>{t('keyUsage.tokenStats')}</h2>
                  </div>
                  <div className={styles.statGrid}>
                    {usageStatCells.map((cell, i) => (
                      <div key={i} className={styles.statCell}>
                        <div className={styles.statLabel}>{cell.label}</div>
                        <div className={styles.statValue}>{cell.value}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Daily Usage Table */}
              {showDailyUsage && (
                <section className={styles.region}>
                  <div className={styles.regionHeaderRow}>
                    <h2 className={styles.sectionTitle}>{t('keyUsage.dailyDetail')}</h2>
                    <SegmentedControl
                      options={dailyUsageOptions}
                      value={String(dailyUsageDays)}
                      label={t('keyUsage.dailyDetail')}
                      onValueChange={(value) => setDailyUsageDays(Number(value) as DailyUsageDays)}
                    />
                  </div>
                  {dailyUsageRows.length > 0 ? (
                    <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>{t('keyUsage.date')}</th>
                            <th data-align="end">{t('keyUsage.requests')}</th>
                            <th data-align="end">{t('keyUsage.inputTokens')}</th>
                            <th data-align="end">{t('keyUsage.outputTokens')}</th>
                            <th data-align="end">{t('keyUsage.cacheReadTokens')}</th>
                            <th data-align="end">{t('keyUsage.cacheWriteTokens')}</th>
                            <th data-align="end">{t('keyUsage.cost')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyUsageRows.map((row) => (
                            <tr key={row.date}>
                              <td className={styles.strong}>{row.date}</td>
                              <td data-align="end">{fmtNum(row.requests)}</td>
                              <td data-align="end">{fmtNum(row.input_tokens)}</td>
                              <td data-align="end">{fmtNum(row.output_tokens)}</td>
                              <td data-align="end">{fmtNum(row.cache_read_tokens)}</td>
                              <td data-align="end">{fmtNum(row.cache_write_tokens)}</td>
                              <td data-align="end" className={styles.strong}>{usd(row.actual_cost != null ? row.actual_cost : row.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className={styles.emptyLine}>{t('keyUsage.noDailyUsage')}</p>
                  )}
                </section>
              )}

              {/* Model Stats Table */}
              {modelStats.length > 0 && (
                <section className={styles.region}>
                  <div className={styles.regionHeader}>
                    <h2 className={styles.sectionTitle}>{t('keyUsage.modelStats')}</h2>
                  </div>
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>{t('keyUsage.model')}</th>
                          <th data-align="end">{t('keyUsage.requests')}</th>
                          <th data-align="end">{t('keyUsage.inputTokens')}</th>
                          <th data-align="end">{t('keyUsage.outputTokens')}</th>
                          <th data-align="end">{t('keyUsage.cacheCreationTokens')}</th>
                          <th data-align="end">{t('keyUsage.cacheReadTokens')}</th>
                          <th data-align="end">{t('keyUsage.totalTokens')}</th>
                          <th data-align="end">{t('keyUsage.cost')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modelStats.map((m, i) => (
                          <tr key={i}>
                            <td className={styles.strong}>{m.model || '-'}</td>
                            <td data-align="end">{fmtNum(m.requests)}</td>
                            <td data-align="end">{fmtNum(m.input_tokens)}</td>
                            <td data-align="end">{fmtNum(m.output_tokens)}</td>
                            <td data-align="end">{fmtNum(m.cache_creation_tokens)}</td>
                            <td data-align="end">{fmtNum(m.cache_read_tokens)}</td>
                            <td data-align="end">{fmtNum(m.total_tokens)}</td>
                            <td data-align="end" className={styles.strong}>{usd(m.actual_cost != null ? m.actual_cost : m.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          ) : null
        )}
      </main>

      {/* Footer (same pattern as HomeView) */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <p className={styles.muted}>
            &copy; {currentYear} {siteName}. {t('home.footer.allRightsReserved')}
          </p>
          {docUrl && (
            <a href={docUrl} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
              {t('home.docs')}
            </a>
          )}
        </div>
      </footer>
    </div>
  )
}
