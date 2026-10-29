import { Check, Clock, RefreshCw, TriangleAlert, User, Users, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import {
  opsAPI,
  type OpsAccountAvailabilityStatsResponse,
  type OpsConcurrencyStatsResponse,
  type OpsUserConcurrencyStatsResponse
} from '@/api/admin/ops'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import panel from './OpsPanel.module.css'
import styles from './OpsConcurrencyCard.module.css'

export interface OpsConcurrencyCardProps {
  platformFilter?: string
  groupIdFilter?: number | null
  refreshToken: number
}

// 平台/分组汇总行数据
interface SummaryRow {
  key: string
  name: string
  platform?: string
  // 账号统计
  total_accounts: number
  available_accounts: number
  rate_limited_accounts: number
  error_accounts: number
  // 并发统计
  total_concurrency: number
  used_concurrency: number
  waiting_in_queue: number
  // 计算字段
  availability_percentage: number
  concurrency_percentage: number
}

// 账号详细行数据
interface AccountRow {
  key: string
  name: string
  platform: string
  group_name: string
  // 并发
  current_in_use: number
  max_capacity: number
  waiting_in_queue: number
  load_percentage: number
  // 状态
  is_available: boolean
  is_rate_limited: boolean
  rate_limit_remaining_sec?: number
  is_overloaded: boolean
  overload_remaining_sec?: number
  has_error: boolean
  error_message?: string
}

// 用户行数据
interface UserRow {
  key: string
  user_id: number
  user_email: string
  username: string
  current_in_use: number
  max_capacity: number
  waiting_in_queue: number
  load_percentage: number
}

type LoadTone = 'danger' | 'orange' | 'warning' | 'success'

function safeNumber(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function getLoadTone(loadPct: number): LoadTone {
  if (loadPct >= 90) return 'danger'
  if (loadPct >= 70) return 'orange'
  if (loadPct >= 50) return 'warning'
  return 'success'
}

function getLoadBarStyle(loadPct: number): CSSProperties {
  return { width: `${Math.min(100, Math.max(0, loadPct))}%` }
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h`
}

function LoadBar({ value }: { value: number }) {
  return (
    <div className={styles.track}>
      <div className={styles.bar} data-tone={getLoadTone(value)} style={getLoadBarStyle(value)} />
    </div>
  )
}

export default function OpsConcurrencyCard({ platformFilter = '', groupIdFilter = null, refreshToken }: OpsConcurrencyCardProps) {
  const { t } = useI18n()

  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [concurrency, setConcurrency] = useState<OpsConcurrencyStatsResponse | null>(null)
  const [availability, setAvailability] = useState<OpsAccountAvailabilityStatsResponse | null>(null)
  const [userConcurrency, setUserConcurrency] = useState<OpsUserConcurrencyStatsResponse | null>(null)

  // 用户视图开关
  const [showByUser, setShowByUser] = useState(false)

  const realtimeEnabled = (concurrency?.enabled ?? true) && (availability?.enabled ?? true)

  // 计算显示维度
  const displayDimension: 'platform' | 'group' | 'account' | 'user' = showByUser
    ? 'user'
    : typeof groupIdFilter === 'number' && groupIdFilter > 0
      ? 'account'
      : platformFilter
        ? 'group'
        : 'platform'

  // 平台维度汇总
  function buildPlatformRows(): SummaryRow[] {
    const concStats = concurrency?.platform || {}
    const availStats = availability?.platform || {}

    const platforms = new Set([...Object.keys(concStats), ...Object.keys(availStats)])

    return Array.from(platforms)
      .map((platform) => {
        const conc = concStats[platform] || {}
        const avail = availStats[platform] || {}

        const totalAccounts = safeNumber(avail.total_accounts)
        const availableAccounts = safeNumber(avail.available_count)
        const totalConcurrency = safeNumber(conc.max_capacity)
        const usedConcurrency = safeNumber(conc.current_in_use)

        return {
          key: platform,
          name: platform.toUpperCase(),
          total_accounts: totalAccounts,
          available_accounts: availableAccounts,
          rate_limited_accounts: safeNumber(avail.rate_limit_count),

          error_accounts: safeNumber(avail.error_count),
          total_concurrency: totalConcurrency,
          used_concurrency: usedConcurrency,
          waiting_in_queue: safeNumber(conc.waiting_in_queue),
          availability_percentage: totalAccounts > 0 ? Math.round((availableAccounts / totalAccounts) * 100) : 0,
          concurrency_percentage: totalConcurrency > 0 ? Math.round((usedConcurrency / totalConcurrency) * 100) : 0
        }
      })
      .sort((a, b) => b.concurrency_percentage - a.concurrency_percentage)
  }

  // 分组维度汇总
  function buildGroupRows(): SummaryRow[] {
    const concStats = concurrency?.group || {}
    const availStats = availability?.group || {}

    const groupIds = new Set([...Object.keys(concStats), ...Object.keys(availStats)])

    const rows = Array.from(groupIds)
      .map((gid) => {
        const conc = concStats[gid] || ({} as Partial<(typeof concStats)[string]>)
        const avail = availStats[gid] || ({} as Partial<(typeof availStats)[string]>)

        // 只显示匹配的平台
        if (platformFilter && conc.platform !== platformFilter && avail.platform !== platformFilter) {
          return null
        }

        const totalAccounts = safeNumber(avail.total_accounts)
        const availableAccounts = safeNumber(avail.available_count)
        const totalConcurrency = safeNumber(conc.max_capacity)
        const usedConcurrency = safeNumber(conc.current_in_use)

        return {
          key: gid,
          name: String(conc.group_name || avail.group_name || `Group ${gid}`),
          platform: String(conc.platform || avail.platform || ''),
          total_accounts: totalAccounts,
          available_accounts: availableAccounts,
          rate_limited_accounts: safeNumber(avail.rate_limit_count),

          error_accounts: safeNumber(avail.error_count),
          total_concurrency: totalConcurrency,
          used_concurrency: usedConcurrency,
          waiting_in_queue: safeNumber(conc.waiting_in_queue),
          availability_percentage: totalAccounts > 0 ? Math.round((availableAccounts / totalAccounts) * 100) : 0,
          concurrency_percentage: totalConcurrency > 0 ? Math.round((usedConcurrency / totalConcurrency) * 100) : 0
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    return rows.sort((a, b) => b.concurrency_percentage - a.concurrency_percentage)
  }

  // 账号维度详细
  function buildAccountRows(): AccountRow[] {
    const concStats = concurrency?.account || {}
    const availStats = availability?.account || {}

    const accountIds = new Set([...Object.keys(concStats), ...Object.keys(availStats)])

    const rows = Array.from(accountIds)
      .map((aid) => {
        const conc = concStats[aid] || ({} as Partial<(typeof concStats)[string]>)
        const avail = availStats[aid] || ({} as Partial<(typeof availStats)[string]>)

        // 只显示匹配的分组
        if (typeof groupIdFilter === 'number' && groupIdFilter > 0) {
          if (conc.group_id !== groupIdFilter && avail.group_id !== groupIdFilter) {
            return null
          }
        }

        return {
          key: aid,
          name: String(conc.account_name || avail.account_name || `Account ${aid}`),
          platform: String(conc.platform || avail.platform || ''),
          group_name: String(conc.group_name || avail.group_name || ''),
          current_in_use: safeNumber(conc.current_in_use),
          max_capacity: safeNumber(conc.max_capacity),
          waiting_in_queue: safeNumber(conc.waiting_in_queue),
          load_percentage: safeNumber(conc.load_percentage),
          is_available: avail.is_available || false,
          is_rate_limited: avail.is_rate_limited || false,
          rate_limit_remaining_sec: avail.rate_limit_remaining_sec,
          is_overloaded: avail.is_overloaded || false,
          overload_remaining_sec: avail.overload_remaining_sec,
          has_error: avail.has_error || false,
          error_message: avail.error_message || ''
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    return rows.sort((a, b) => {
      // 优先显示异常账号
      if (a.has_error !== b.has_error) return a.has_error ? -1 : 1
      if (a.is_rate_limited !== b.is_rate_limited) return a.is_rate_limited ? -1 : 1
      // 然后按负载排序
      return b.load_percentage - a.load_percentage
    })
  }

  // 用户维度详细
  function buildUserRows(): UserRow[] {
    const userStats = userConcurrency?.user || {}

    return Object.keys(userStats)
      .map((uid) => {
        const u = userStats[uid] || ({} as Partial<(typeof userStats)[string]>)
        return {
          key: uid,
          user_id: safeNumber(u.user_id),
          user_email: u.user_email || `User ${uid}`,
          username: u.username || '',
          current_in_use: safeNumber(u.current_in_use),
          max_capacity: safeNumber(u.max_capacity),
          waiting_in_queue: safeNumber(u.waiting_in_queue),
          load_percentage: safeNumber(u.load_percentage)
        }
      })
      .sort((a, b) => b.current_in_use - a.current_in_use || b.load_percentage - a.load_percentage)
  }

  // 根据维度选择数据
  const userRows = displayDimension === 'user' ? buildUserRows() : []
  const accountRows = displayDimension === 'account' ? buildAccountRows() : []
  const summaryRows = displayDimension === 'group' ? buildGroupRows() : displayDimension === 'platform' ? buildPlatformRows() : []
  const displayCount =
    displayDimension === 'user' ? userRows.length : displayDimension === 'account' ? accountRows.length : summaryRows.length

  const displayTitle =
    displayDimension === 'user'
      ? t('admin.ops.concurrency.byUser')
      : displayDimension === 'account'
        ? t('admin.ops.concurrency.byAccount')
        : displayDimension === 'group'
          ? t('admin.ops.concurrency.byGroup')
          : t('admin.ops.concurrency.byPlatform')

  const loadData = useCallback(async () => {
    setLoading(true)
    setErrorMessage('')
    try {
      if (showByUser) {
        // 用户视图模式只加载用户并发数据
        const userData = await opsAPI.getUserConcurrencyStats()
        setUserConcurrency(userData)
      } else {
        // 常规模式加载账号/平台/分组数据
        const [concData, availData] = await Promise.all([
          opsAPI.getConcurrencyStats(platformFilter, groupIdFilter),
          opsAPI.getAccountAvailabilityStats(platformFilter, groupIdFilter)
        ])
        setConcurrency(concData)
        setAvailability(availData)
      }
    } catch (err: any) {
      console.error('[OpsConcurrencyCard] Failed to load data', err)
      setErrorMessage(err?.response?.data?.detail || t('admin.ops.concurrency.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [showByUser, platformFilter, groupIdFilter, t])

  // effect 通过 ref 调用最新的 loadData。
  const loadRef = useRef(loadData)
  useEffect(() => {
    loadRef.current = loadData
  }, [loadData])

  // 实时监控开启时（含首次挂载）加载数据（Vue: watch(realtimeEnabled, { immediate: true })）。
  useEffect(() => {
    if (realtimeEnabled) void loadRef.current()
  }, [realtimeEnabled])

  // 刷新节奏由父组件统一控制（OpsDashboard Header 的刷新状态/倒计时）
  const lastRefreshToken = useRef(refreshToken)
  const realtimeEnabledRef = useRef(realtimeEnabled)
  useEffect(() => {
    realtimeEnabledRef.current = realtimeEnabled
  }, [realtimeEnabled])
  useEffect(() => {
    if (lastRefreshToken.current === refreshToken) return
    lastRefreshToken.current = refreshToken
    if (!realtimeEnabledRef.current) return
    void loadRef.current()
  }, [refreshToken])

  // 切换用户视图时重新加载数据
  const lastShowByUser = useRef(showByUser)
  useEffect(() => {
    if (lastShowByUser.current === showByUser) return
    lastShowByUser.current = showByUser
    void loadRef.current()
  }, [showByUser])

  return (
    <section className={[panel.panel, panel.fill].join(' ')}>
      {/* 头部 */}
      <div className={panel.header}>
        <h2 className={panel.title}>
          <Zap size={16} aria-hidden="true" />
          {t('admin.ops.concurrency.title')}
        </h2>
        <div className={panel.toolbar}>
          {/* 用户视图切换按钮 */}
          <Button
            type="button"
            variant={showByUser ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={showByUser}
            title={showByUser ? t('admin.ops.concurrency.switchToPlatform') : t('admin.ops.concurrency.switchToUser')}
            aria-label={showByUser ? t('admin.ops.concurrency.switchToPlatform') : t('admin.ops.concurrency.switchToUser')}
            onClick={() => setShowByUser((v) => !v)}
          >
            <User size={14} aria-hidden="true" />
          </Button>
          {/* 刷新按钮 */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={() => void loadData()}
          >
            <RefreshCw size={14} aria-hidden="true" className={loading ? styles.spin : undefined} />
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {errorMessage && <Alert tone="danger" title={errorMessage} />}

      {!realtimeEnabled ? (
        // 禁用状态
        <div className={styles.disabled}>{t('admin.ops.concurrency.disabledHint')}</div>
      ) : (
        // 数据展示区域
        <div className={styles.frame}>
          {/* 维度标题栏 */}
          <div className={styles.dimensionBar}>
            <span>{displayTitle}</span>
            <span>{t('admin.ops.concurrency.totalRows', { count: displayCount })}</span>
          </div>

          {displayCount === 0 ? (
            // 空状态
            <div className={styles.empty}>{t('admin.ops.concurrency.empty')}</div>
          ) : displayDimension === 'user' ? (
            // 用户视图
            <div className={styles.list}>
              {userRows.map((row) => (
                <div key={row.key} className={styles.item}>
                  {/* 用户信息和并发 */}
                  <div className={styles.itemHead}>
                    <div className={styles.userName}>
                      <span className={styles.name} title={row.username || row.user_email}>
                        {row.username || row.user_email}
                      </span>
                      {row.username && (
                        <span className={styles.secondary} title={row.user_email}>
                          {row.user_email}
                        </span>
                      )}
                    </div>
                    <div className={styles.metrics}>
                      <span className={styles.mono}>
                        {row.current_in_use}/{row.max_capacity}
                      </span>
                      <span className={styles.pct} data-tone={getLoadTone(row.load_percentage)}>
                        {Math.round(row.load_percentage)}%
                      </span>
                    </div>
                  </div>
                  {/* 进度条 */}
                  <LoadBar value={row.load_percentage} />
                  {/* 等待队列 */}
                  {row.waiting_in_queue > 0 && (
                    <div className={styles.queueRow}>
                      <span className={styles.pill} data-tone="queue">
                        {t('admin.ops.concurrency.queued', { count: row.waiting_in_queue })}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : displayDimension === 'platform' || displayDimension === 'group' ? (
            // 汇总视图（平台/分组）
            <div className={styles.list}>
              {summaryRows.map((row) => (
                <div key={row.key} className={styles.item}>
                  {/* 标题行 */}
                  <div className={styles.itemHead}>
                    <div className={styles.userName}>
                      <div className={styles.name} title={row.name}>
                        {row.name}
                      </div>
                      {displayDimension === 'group' && row.platform && <span className={styles.secondary}>{row.platform.toUpperCase()}</span>}
                    </div>
                    <div className={styles.metrics}>
                      <span className={styles.mono}>
                        {row.used_concurrency}/{row.total_concurrency}
                      </span>
                      <span className={styles.pct} data-tone={getLoadTone(row.concurrency_percentage)}>
                        {row.concurrency_percentage}%
                      </span>
                    </div>
                  </div>

                  {/* 进度条 */}
                  <LoadBar value={row.concurrency_percentage} />

                  {/* 统计信息 */}
                  <div className={styles.statsRow}>
                    {/* 账号统计 */}
                    <div className={styles.accounts}>
                      <Users size={12} aria-hidden="true" className={styles.mutedIcon} />
                      <span>
                        <span className={styles.available}>{row.available_accounts}</span>/{row.total_accounts}
                      </span>
                      <span className={styles.secondary}>{row.availability_percentage}%</span>
                    </div>

                    {/* 限流账号 */}
                    {row.rate_limited_accounts > 0 && (
                      <span className={styles.pill} data-tone="warning">
                        {t('admin.ops.concurrency.rateLimited', { count: row.rate_limited_accounts })}
                      </span>
                    )}

                    {/* 异常账号 */}
                    {row.error_accounts > 0 && (
                      <span className={styles.pill} data-tone="danger">
                        {t('admin.ops.concurrency.errorAccounts', { count: row.error_accounts })}
                      </span>
                    )}

                    {/* 等待队列 */}
                    {row.waiting_in_queue > 0 && (
                      <span className={styles.pill} data-tone="queue">
                        {t('admin.ops.concurrency.queued', { count: row.waiting_in_queue })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // 账号详细视图
            <div className={styles.list}>
              {accountRows.map((row) => (
                <div key={row.key} className={styles.item}>
                  {/* 账号名称和并发 */}
                  <div className={styles.itemHead}>
                    <div className={styles.accountText}>
                      <div className={styles.name} title={row.name}>
                        {row.name}
                      </div>
                      <div className={styles.groupName}>{row.group_name}</div>
                    </div>
                    <div className={styles.metrics}>
                      {/* 并发使用 */}
                      <span className={styles.mono}>
                        {row.current_in_use}/{row.max_capacity}
                      </span>
                      {/* 状态徽章 */}
                      {row.is_available ? (
                        <span className={styles.status} data-tone="success">
                          <Check size={12} aria-hidden="true" />
                          {t('admin.ops.accountAvailability.available')}
                        </span>
                      ) : row.is_rate_limited ? (
                        <span className={styles.status} data-tone="warning">
                          <Clock size={12} aria-hidden="true" />
                          {formatDuration(row.rate_limit_remaining_sec || 0)}
                        </span>
                      ) : row.is_overloaded ? (
                        <span className={styles.status} data-tone="danger">
                          <TriangleAlert size={12} aria-hidden="true" />
                          {formatDuration(row.overload_remaining_sec || 0)}
                        </span>
                      ) : row.has_error ? (
                        <span className={styles.status} data-tone="danger">
                          <X size={12} aria-hidden="true" />
                          {t('admin.ops.accountAvailability.accountError')}
                        </span>
                      ) : (
                        <span className={styles.status}>{t('admin.ops.accountAvailability.unavailable')}</span>
                      )}
                    </div>
                  </div>

                  {/* 进度条 */}
                  <LoadBar value={row.load_percentage} />

                  {/* 等待队列 */}
                  {row.waiting_in_queue > 0 && (
                    <div className={styles.queueRow}>
                      <span className={styles.pill} data-tone="queue">
                        {t('admin.ops.concurrency.queued', { count: row.waiting_in_queue })}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
