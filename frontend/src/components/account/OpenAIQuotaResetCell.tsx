/**
 * Codex 上游额度：重置卡次数、点数查询与消耗重置卡，对应 Vue 版 OpenAIQuotaResetCell.vue。
 */
import { RefreshCw, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  refreshOpenAIQuota,
  resetOpenAIQuota,
  type OpenAIQuotaResetResult,
  type OpenAIQuotaUsage
} from '@/api/admin/accounts'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import OpenAIReferralCell from './OpenAIReferralCell'
import styles from './usageCells.module.css'
import local from './OpenAIQuotaResetCell.module.css'

export interface OpenAIQuotaResetCellProps {
  account: Account
  onAccountUpdated?: (account: Account) => void
  /**
   * 父组件已有的「本地查询」按钮（Vue 版 #pre-actions 插槽），
   * 与本单元格的按钮合并为一排，避免出现两行近似的「查询」。
   */
  preActions?: ReactNode
  className?: string
}

type CreditsData = { credits: NonNullable<OpenAIQuotaUsage['credits']>; fetched_at?: number }
type AutoResetCreditState = NonNullable<NonNullable<Account['extra']>['codex_auto_reset_credit_state']>

const readCachedCredits = (account: Account): CreditsData | null => {
  const snapshot = account.extra?.codex_credits_snapshot
  const credits = snapshot?.credits
  if (!credits || typeof credits.has_credits !== 'boolean' || typeof credits.unlimited !== 'boolean') return null
  if (credits.balance != null && typeof credits.balance !== 'string') return null
  return { credits, fetched_at: snapshot.fetched_at }
}

// Rehydrate the card from the persisted snapshot. Credits that already expired
// are dropped and the count is clamped to what remains: the snapshot has no
// freshness signal, so an unfiltered read would offer to consume credits that no
// longer exist. A snapshot claiming credits with no usable expiration left is
// treated as absent, which keeps the reset button gated on a live query.
const readCachedResetCredits = (account: Account): OpenAIQuotaUsage | null => {
  const cached = account.extra?.codex_reset_credit_snapshot
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return null

  const { available_count: count, credits: rawCredits } = cached as {
    available_count?: unknown
    credits?: unknown
  }
  if (typeof count !== 'number' || !Number.isFinite(count)) return null

  const now = Date.now()
  const credits: { expires_at?: string }[] = []
  if (Array.isArray(rawCredits)) {
    for (const credit of rawCredits) {
      if (!credit || typeof credit !== 'object') continue
      const expiresAt = (credit as { expires_at?: unknown }).expires_at
      if (typeof expiresAt !== 'string' || expiresAt.trim() === '') continue
      const expiryTime = new Date(expiresAt).getTime()
      // Unparsable timestamps are kept: they are already rendered verbatim and
      // dropping them would silently understate the available count.
      if (!Number.isNaN(expiryTime) && expiryTime <= now) continue
      credits.push({ expires_at: expiresAt })
    }
  }
  const availableCount = Math.min(Math.max(count, 0), credits.length)
  // A snapshot that claimed credits but has none left is no longer informative;
  // report "unknown" so the operator re-queries instead of trusting it.
  if (count > 0 && availableCount <= 0) return null
  return {
    fetched_at: 0,
    rate_limit_reset_credits: {
      available_count: availableCount,
      credits
    }
  }
}

const getResetCreditExpiryTime = (value: string): number => {
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

const compareResetCreditExpiry = (a: string, b: string): number => {
  const diff = getResetCreditExpiryTime(a) - getResetCreditExpiryTime(b)
  if (diff !== 0) return diff
  return a.localeCompare(b)
}

const formatResetCreditExpiry = (value: string, style: 'short' | 'full'): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const options: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }
  if (style === 'full') {
    options.year = 'numeric'
  }

  return new Intl.DateTimeFormat(undefined, options).format(date)
}

const validAutoResetStatuses = new Set(['checking', 'available', 'resetting', 'success', 'no_credit', 'failed'])
const autoStatusKeys: Record<string, string> = {
  checking: 'checking',
  available: 'available',
  resetting: 'resetting',
  success: 'success',
  no_credit: 'noCredit',
  failed: 'failed'
}
const autoStatusTones: Record<string, string> = {
  available: 'info',
  success: 'success',
  no_credit: 'danger',
  failed: 'danger',
  resetting: 'warning'
}

/**
 * 仅 OpenAI OAuth 账号可见。账号行在分页列表中可能被复用：切换账号 id 时整体重建，
 * 丢弃进行中请求的结果并重新读取缓存（Vue 版 watch(account.id) 重置）。
 */
export default function OpenAIQuotaResetCell(props: OpenAIQuotaResetCellProps) {
  if (props.account.platform !== 'openai' || props.account.type !== 'oauth') return null
  return <OpenAIQuotaResetCellInner key={props.account.id} {...props} />
}

function OpenAIQuotaResetCellInner({ account, onAccountUpdated, preActions, className }: OpenAIQuotaResetCellProps) {
  const { t } = useI18n()

  const [loading, setLoadingState] = useState(false)
  const [resetting, setResettingState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cachedData, setCachedData] = useState<OpenAIQuotaUsage | null>(() => readCachedResetCredits(account))
  const [data, setData] = useState<OpenAIQuotaUsage | null>(() => readCachedResetCredits(account))
  const [resetMessage, setResetMessage] = useState<string | null>(null)
  const [resetWarning, setResetWarning] = useState<string | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showResetCreditDetailsState, setShowResetCreditDetails] = useState(false)
  const [creditsCacheWarning, setCreditsCacheWarning] = useState(false)
  const [creditsData, setCreditsData] = useState<CreditsData | null>(() => readCachedCredits(account))
  const loadingRef = useRef(false)
  const resettingRef = useRef(false)
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
  const setResetting = (value: boolean) => {
    resettingRef.current = value
    setResettingState(value)
  }

  const creditsDisplay = (() => {
    const credits = creditsData?.credits
    if (!credits) return '—'
    if (credits.unlimited) return t('admin.accounts.openaiQuotaReset.pointsUnlimited')
    if (!credits.has_credits) return '0'
    const balance = credits.balance?.trim()
    // Keep the upstream decimal string intact, including fractional points.
    if (balance && Number.isFinite(Number(balance)) && Number(balance) >= 0) return balance
    return t('admin.accounts.openaiQuotaReset.pointsAvailable')
  })()

  const creditsButtonTitle = (() => {
    const fetchedAt = creditsData?.fetched_at
    const refresh = t('admin.accounts.openaiQuotaReset.pointsTooltip')
    if (!fetchedAt || !Number.isFinite(fetchedAt)) return refresh
    return `${refresh}\n${t('admin.accounts.openaiQuotaReset.pointsUpdatedAt', {
      time: new Date(fetchedAt * 1000).toLocaleString()
    })}`
  })()

  const updateCredits = (usage: OpenAIQuotaUsage | null) => {
    setCreditsData(usage?.credits ? { credits: usage.credits, fetched_at: usage.fetched_at } : null)
  }

  const autoResetState = (() => {
    if (account.extra?.auto_reset_credit_enabled !== true) return null
    const state = account.extra?.codex_auto_reset_credit_state
    if (!state || typeof state !== 'object' || !validAutoResetStatuses.has(String(state.status))) return null
    return state as AutoResetCreditState
  })()
  const autoResetStateLabel = autoResetState?.status
    ? t(`admin.accounts.openaiQuotaReset.autoStatus.${autoStatusKeys[autoResetState.status]}`)
    : ''

  // 影子账号的额度查询会 resolve 到母账号,但影子本身不支持重置(后端返回 409);
  // 重置必须在母账号上进行。前端据此禁用影子的重置入口(外审 F6)。
  const isShadow = account.parent_account_id != null

  const availableResetCount = data?.rate_limit_reset_credits?.available_count ?? 0
  // Prefer the live payload and fall back to the persisted snapshot only when the
  // live state is unknown, so the count and the expirations never come from two
  // different generations of the same data.
  const resetCreditExpirations = ((data ?? cachedData)?.rate_limit_reset_credits?.credits ?? [])
    .map((credit) => credit.expires_at?.trim() ?? '')
    .filter((expiresAt) => expiresAt.length > 0)
    .sort(compareResetCreditExpiry)
  const primaryResetCreditExpiry = resetCreditExpirations[0] ?? ''
  const hiddenResetCreditCount = Math.max(resetCreditExpirations.length - 1, 0)
  // 只剩一张（或没有）时自动收起明细（Vue 版 watch(resetCreditExpirations)）
  const showResetCreditDetails = showResetCreditDetailsState && hiddenResetCreditCount > 0
  const canReset = availableResetCount > 0 && !isShadow

  const resetCreditDetailsTitle = resetCreditExpirations
    .map((expiresAt) => formatResetCreditExpiry(expiresAt, 'full'))
    .join('\n')

  const resetCreditDetailsToggleLabel = showResetCreditDetails
    ? t('admin.accounts.openaiQuotaReset.collapseExpirations')
    : t('admin.accounts.openaiQuotaReset.expandExpirations', { count: hiddenResetCreditCount })

  const resetButtonTitle = isShadow
    ? t('admin.accounts.openaiQuotaReset.resetTooltipShadow')
    : !data
      ? t('admin.accounts.openaiQuotaReset.resetTooltipNeedQuery')
      : !canReset
        ? t('admin.accounts.openaiQuotaReset.resetTooltipNoCredits')
        : t('admin.accounts.openaiQuotaReset.resetTooltipReady')

  // "次数" button doubles as the upstream-query trigger and the count display.
  // Tooltip differs between "click to load" (no data yet) and "click to refresh".
  const countButtonTitle = !data
    ? t('admin.accounts.openaiQuotaReset.countTooltipLoad')
    : t('admin.accounts.openaiQuotaReset.countTooltipRefresh')

  const truncatedError = error ? (error.length > 80 ? `${error.slice(0, 80)}…` : error) : ''

  const extractErrorMessage = (e: unknown): string => {
    // The project's axios response interceptor (api/client.ts) flattens server
    // errors into { status, code, message, reason, ... } and re-rejects them, so
    // the message lives at the top level rather than under .response.data. Fall
    // back to the raw axios shape for the cancellation/network branches that
    // bypass the flattening, and finally to the generic i18n string.
    const err = e as {
      message?: string
      reason?: string
      response?: { data?: { message?: string; error?: string } }
    }
    return (
      err?.message || err?.reason || err?.response?.data?.message || err?.response?.data?.error || t('common.error')
    )
  }

  const toggleResetCreditDetails = () => {
    if (hiddenResetCreditCount <= 0) return
    setShowResetCreditDetails(!showResetCreditDetails)
  }

  const handleQuery = async () => {
    if (loadingRef.current || resettingRef.current) return
    const accountID = account.id
    setLoading(true)
    setCreditsCacheWarning(false)
    setError(null)
    setResetMessage(null)
    setResetWarning(null)
    setShowResetCreditDetails(false)
    try {
      const result = await refreshOpenAIQuota(accountID)
      if (disposed.current) return
      updateCredits(result)
      setCreditsCacheWarning(result.credits_cache_persisted === false)
      // The upstream read succeeded even when the snapshot write was rejected, so
      // the live count is always adopted. Only the persisted view is left alone,
      // which keeps the displayed expirations consistent with what is stored.
      setData(result)
      if (result.cache_persisted) {
        setCachedData(result)
      } else {
        setResetWarning(t('admin.accounts.openaiQuotaReset.refreshCachePersistFailed'))
      }
    } catch (e) {
      if (disposed.current) return
      setError(extractErrorMessage(e))
    } finally {
      if (!disposed.current) setLoading(false)
    }
  }

  const openResetConfirm = () => {
    if (resettingRef.current || loadingRef.current) return
    if (!canReset) {
      setError(t('admin.accounts.openaiQuotaReset.noCreditsAvailable'))
      return
    }
    setShowResetConfirm(true)
  }

  const confirmReset = async () => {
    setShowResetConfirm(false)
    if (resettingRef.current) return
    if (!canReset) {
      setError(t('admin.accounts.openaiQuotaReset.noCreditsAvailable'))
      return
    }
    setResetting(true)
    const accountID = account.id
    setCreditsCacheWarning(false)
    setError(null)
    setResetMessage(null)
    setResetWarning(null)
    try {
      const result: OpenAIQuotaResetResult = await resetOpenAIQuota(accountID)
      if (disposed.current) return
      updateCredits(result.quota ?? null)
      setShowResetCreditDetails(false)
      if (result.cache_refreshed && result.quota) {
        setData(result.quota)
        setCachedData(result.quota)
      } else {
        // A credit was consumed but the post-reset count could not be read back.
        // Whatever we still hold is one generation stale, so report the count as
        // unknown instead of letting a second consumption start from stale data.
        setData(null)
      }
      if (result.account) onAccountUpdated?.(result.account)

      if (result.warning_code === 'reset_credit_cache_refresh_failed') {
        setResetWarning(t('admin.accounts.openaiQuotaReset.resetCacheRefreshFailed'))
      } else if (result.warning_code === 'account_state_recovery_failed') {
        setResetWarning(t('admin.accounts.openaiQuotaReset.resetAccountRecoveryFailed'))
      } else if (result.warning_code === 'account_state_refresh_failed') {
        setResetWarning(t('admin.accounts.openaiQuotaReset.resetAccountRefreshFailed'))
      } else {
        setResetMessage(t('admin.accounts.openaiQuotaReset.resetSuccess', { windows: result.windows_reset }))
      }
    } catch (e) {
      if (disposed.current) return
      setError(extractErrorMessage(e))
    } finally {
      if (!disposed.current) setResetting(false)
    }
  }

  /*
    Unified action row. Parents that already render their own "local query"
    affordance (e.g. AccountUsageCell's active-sampling refresh) pass it in
    via preActions so the user sees a single row of related buttons rather
    than two near-duplicate "查询" rows.

    The 5h / 7d window bars are deliberately NOT rendered here — the local
    active-sampling display (UsageProgressBar in AccountUsageCell) already
    owns that real estate. This cell queries Codex points and reset credits,
    and lets the operator consume a reset credit if needed.
  */
  return (
    <div className={[styles.stack, className].filter(Boolean).join(' ')}>
      <div className={styles.actionsRow}>
        {preActions}

        <button
          type="button"
          className={styles.action}
          disabled={loading || resetting}
          title={countButtonTitle}
          onClick={() => void handleQuery()}
        >
          <RefreshCw className={[styles.actionIcon, loading ? styles.spin : ''].join(' ')} aria-hidden="true" />
          {t('admin.accounts.openaiQuotaReset.count')}
          {data ? <span className={local.count}>{availableResetCount}</span> : null}
        </button>

        <button
          type="button"
          className={styles.action}
          data-tone="warning"
          disabled={resetting || loading || !canReset}
          title={resetButtonTitle}
          onClick={openResetConfirm}
        >
          <RotateCw className={[styles.actionIcon, resetting ? styles.spin : ''].join(' ')} aria-hidden="true" />
          {t('admin.accounts.openaiQuotaReset.reset')}
        </button>

        <button
          type="button"
          data-testid="codex-credits"
          className={styles.action}
          data-tone="success"
          disabled={loading || resetting}
          title={creditsButtonTitle}
          onClick={() => void handleQuery()}
        >
          {t('admin.accounts.openaiQuotaReset.points')}
          <span className={local.points}>{creditsDisplay}</span>
        </button>
        <OpenAIReferralCell account={account} />
      </div>

      {creditsCacheWarning ? (
        <div className={styles.warningTiny}>{t('admin.accounts.openaiQuotaReset.pointsCachePersistFailed')}</div>
      ) : null}

      {autoResetState ? (
        <div className={local.autoState} data-testid="auto-reset-credit-state">
          <span className={styles.tag} data-tone={autoStatusTones[String(autoResetState.status)] ?? 'neutral'}>
            {autoResetStateLabel}
            {autoResetState.trigger_window ? <span className={local.count}>{autoResetState.trigger_window}</span> : null}
          </span>
          {autoResetState.checked_at ? (
            <span className={local.muted}>{formatResetCreditExpiry(autoResetState.checked_at, 'short')}</span>
          ) : null}
          {autoResetState.error_code ? (
            <span className={local.errorCode} title={autoResetState.error_code}>
              {autoResetState.error_code}
            </span>
          ) : null}
        </div>
      ) : null}

      {primaryResetCreditExpiry ? (
        <div className={styles.stack}>
          <div className={styles.wrapRow}>
            <span
              className={styles.tag}
              title={t('admin.accounts.openaiQuotaReset.expiresAtFull', {
                time: formatResetCreditExpiry(primaryResetCreditExpiry, 'full')
              })}
            >
              {t('admin.accounts.openaiQuotaReset.expiresAt', {
                time: formatResetCreditExpiry(primaryResetCreditExpiry, 'short')
              })}
            </span>
            {hiddenResetCreditCount > 0 ? (
              <button
                type="button"
                data-testid="reset-credit-expiry-toggle"
                className={local.toggle}
                aria-expanded={showResetCreditDetails}
                aria-label={resetCreditDetailsToggleLabel}
                title={resetCreditDetailsTitle}
                onClick={toggleResetCreditDetails}
              >
                +{hiddenResetCreditCount}
              </button>
            ) : null}
          </div>

          {showResetCreditDetails && resetCreditExpirations.length > 1 ? (
            <div data-testid="reset-credit-expiry-details" className={local.details}>
              <span className={local.srOnly}>{t('admin.accounts.openaiQuotaReset.expirationDetails')}</span>
              {resetCreditExpirations.map((expiresAt, index) => (
                <span
                  key={`${expiresAt}-${index}`}
                  className={local.detailItem}
                  title={t('admin.accounts.openaiQuotaReset.expiresAtFull', {
                    time: formatResetCreditExpiry(expiresAt, 'full')
                  })}
                >
                  <span className={local.dot} />
                  <span className={local.truncate}>{formatResetCreditExpiry(expiresAt, 'short')}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Error / success feedback */}
      {error ? (
        <div className={local.feedbackError} title={error}>
          {truncatedError}
        </div>
      ) : resetWarning ? (
        <div className={styles.warningTiny}>{resetWarning}</div>
      ) : resetMessage ? (
        <div className={styles.successTiny}>{resetMessage}</div>
      ) : null}

      <ConfirmDialog
        show={showResetConfirm}
        title={t('admin.accounts.openaiQuotaReset.confirmTitle')}
        message={t('admin.accounts.openaiQuotaReset.confirmMessage', { count: availableResetCount })}
        confirmText={t('admin.accounts.openaiQuotaReset.reset')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmReset()}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  )
}
