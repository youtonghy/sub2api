/**
 * Claude 订阅重置券查询与兑换，对应 Vue 版 ClaudeResetCreditsCell.vue。
 */
import { RefreshCw, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  getClaudeResetCredits,
  redeemClaudeResetCredit,
  type ClaudeResetCredits,
  type ClaudeResetOutcome
} from '@/api/admin/claudeResetCredits'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import styles from './usageCells.module.css'

export interface ClaudeResetCreditsCellProps {
  account: Account
  /** Fired after a redemption attempt so the parent can refresh the usage row. */
  onRedeemed?: (outcome: ClaudeResetOutcome) => void
  /** 父组件的本地「查询」按钮（Vue 版 #pre-actions 插槽），与本单元格按钮同排 */
  preActions?: ReactNode
  className?: string
}

type Feedback = { kind: 'success' | 'warning' | 'error'; text: string }

// 与 OpenAIQuotaResetCell 的到期时间格式保持一致
const formatTime = (value: string, style: 'short' | 'full'): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const options: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
  if (style === 'full') options.year = 'numeric'
  return new Intl.DateTimeFormat(undefined, options).format(date)
}

// 缺失或无法解析的到期时间排在最后
function expiryMs(value?: string): number {
  const ms = value ? new Date(value).getTime() : NaN
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

const isFutureTime = (value: string) => new Date(value).getTime() > Date.now()

// 已知窗口显示为可读名称，未知窗口原样显示
const windowKeys: Record<string, string> = {
  five_hour: 'fiveHour',
  seven_day: 'sevenDay',
  seven_day_overage_included: 'sevenDayOverage'
}

function newOperationKey(accountID: number): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `claude-reset-${accountID}-${id}`
}

// Refusals issued before any claim was sent: the next attempt is a new confirmation.
const preClaimRefusals = new Set([
  'CLAUDE_RESET_BUSY',
  'CLAUDE_RESET_NOT_AVAILABLE',
  'CLAUDE_RESET_UNRESOLVED',
  'CLAUDE_RESET_UPSTREAM_UNAVAILABLE'
])

const accountKey = (account: Account) => `${account.id}|${account.platform}|${account.type}`

/** 账号（id / 平台 / 类型）变化时整体重建，丢弃全部本地状态（Vue 版 watch 重置） */
export default function ClaudeResetCreditsCell(props: ClaudeResetCreditsCellProps) {
  return <ClaudeResetCreditsCellInner key={accountKey(props.account)} {...props} />
}

function ClaudeResetCreditsCellInner({ account, onRedeemed, preActions, className }: ClaudeResetCreditsCellProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<ClaudeResetCredits | null>(null)
  const [loading, setLoadingState] = useState(false)
  const [error, setError] = useState(false)
  const [redeeming, setRedeemingState] = useState(false)
  const [showRedeemConfirm, setShowRedeemConfirm] = useState(false)
  const [redeemFeedback, setRedeemFeedback] = useState<Feedback | null>(null)
  // 同一事件里连续读取时不读到旧值
  const loadingRef = useRef(false)
  const redeemingRef = useRef(false)
  // One key per operator confirmation. It survives a failed request so retrying the
  // same confirmation replays server-side instead of claiming a second reset.
  const pendingKey = useRef<string | null>(null)
  const generation = useRef(0)

  // 卸载（含切换账号）后丢弃进行中请求的结果
  useEffect(() => {
    const gen = generation
    return () => {
      gen.current++
    }
  }, [])

  const setLoading = (value: boolean) => {
    loadingRef.current = value
    setLoadingState(value)
  }
  const setRedeeming = (value: boolean) => {
    redeemingRef.current = value
    setRedeemingState(value)
  }

  const visible = account.platform === 'anthropic' && account.type === 'oauth'

  const windowLabels = (windows?: string[]): string =>
    (windows ?? [])
      .map((w) => (windowKeys[w] ? t(`admin.accounts.claudeResetCredits.windows.${windowKeys[w]}`) : w))
      .join(', ')

  // 与 Codex 的「次数」一致：显示持有的剩余次数，而不是此刻可兑换的次数
  const totalResets = (status?.credits ?? []).reduce((sum, c) => sum + c.resets_left, 0)

  // 优先展示下一张会被使用的券（仅它可能 redeemable），否则取最早到期的一张
  const primaryCredit = (() => {
    const credits = status?.credits ?? []
    return (
      credits.find((c) => c.redeemable) ??
      [...credits].sort((a, b) => expiryMs(a.expires_at) - expiryMs(b.expires_at))[0] ??
      null
    )
  })()

  // 仅在冷却时间仍在未来时提示（后端已清理过期值，这里防御性再判断一次）
  const cooldownUntil = status?.cooldown_until
  const cooldownActive = !!cooldownUntil && isFutureTime(cooldownUntil)

  const creditTitle = (() => {
    const credit = primaryCredit
    if (!credit) return ''
    const lines = [credit.label]
    if (credit.expires_at) {
      lines.push(t('admin.accounts.claudeResetCredits.expiresAtFull', { time: formatTime(credit.expires_at, 'full') }))
    }
    if (credit.clears.length) {
      lines.push(t('admin.accounts.claudeResetCredits.clears', { windows: windowLabels(credit.clears) }))
    }
    if (credit.use_requires_limit) lines.push(t('admin.accounts.claudeResetCredits.requiresLimit'))
    return lines.join('\n')
  })()

  const countButtonTitle = !status
    ? t('admin.accounts.claudeResetCredits.countTooltipLoad')
    : [
        t('admin.accounts.claudeResetCredits.countTooltipRefresh'),
        t('admin.accounts.claudeResetCredits.fetched', { time: formatTime(status.fetched_at, 'full') })
      ].join('\n')

  const canRedeem = (status?.available_count ?? 0) > 0

  const redeemButtonTitle = !status
    ? t('admin.accounts.claudeResetCredits.resetTooltipNeedQuery')
    : !canRedeem
      ? t('admin.accounts.claudeResetCredits.resetTooltipNone')
      : t('admin.accounts.claudeResetCredits.resetTooltipReady')

  const confirmMessage = (() => {
    const next = status?.credits.find((c) => c.redeemable)
    return t('admin.accounts.claudeResetCredits.confirmMessage', {
      windows: windowLabels(next?.clears) || '—',
      count: Math.max(totalResets - 1, 0)
    })
  })()

  function outcomeFeedback(result: ClaudeResetOutcome): Feedback {
    const prefix = 'admin.accounts.claudeResetCredits.outcome'
    switch (result.outcome) {
      case 'reset':
        return { kind: 'success', text: t(`${prefix}.reset`, { windows: windowLabels(result.cleared) || '—' }) }
      case 'already_used':
        return { kind: 'warning', text: t(`${prefix}.alreadyUsed`) }
      case 'cooldown':
        return {
          kind: 'warning',
          text: result.cooldown_until
            ? t(`${prefix}.cooldownUntil`, { time: formatTime(result.cooldown_until, 'short') })
            : t(`${prefix}.cooldown`)
        }
      case 'not_limited':
        return { kind: 'warning', text: t(`${prefix}.notLimited`) }
      case 'ineligible':
        return { kind: 'error', text: t(`${prefix}.ineligible`) }
      default:
        if (result.reason === 'upstream_unavailable') return { kind: 'warning', text: t(`${prefix}.unavailable`) }
        return { kind: 'warning', text: t(`${prefix}.unknown`) }
    }
  }

  function errorText(e: unknown): string {
    const err = e as { reason?: string; message?: string }
    switch (err?.reason) {
      case 'CLAUDE_RESET_UNRESOLVED':
        return t('admin.accounts.claudeResetCredits.outcome.unknown')
      case 'CLAUDE_RESET_BUSY':
        return t('admin.accounts.claudeResetCredits.outcome.busy')
      case 'CLAUDE_RESET_NOT_AVAILABLE':
        return t('admin.accounts.claudeResetCredits.outcome.notAvailable')
      case 'CLAUDE_RESET_UPSTREAM_UNAVAILABLE':
        return t('admin.accounts.claudeResetCredits.outcome.unavailable')
      case 'IDEMPOTENCY_IN_PROGRESS':
        return t('admin.accounts.claudeResetCredits.outcome.inProgress')
      case 'IDEMPOTENCY_RETRY_BACKOFF':
        return t('admin.accounts.claudeResetCredits.outcome.retryBackoff')
      default:
        return err?.message || t('admin.accounts.claudeResetCredits.outcome.failed')
    }
  }

  async function refresh() {
    if (loadingRef.current || redeemingRef.current) return
    const current = ++generation.current
    setLoading(true)
    setError(false)
    try {
      const result = await getClaudeResetCredits(account.id)
      if (current === generation.current) setStatus(result)
    } catch {
      if (current === generation.current) {
        setError(true)
        setStatus(null)
      }
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  function openRedeemConfirm() {
    if (redeemingRef.current || loadingRef.current || !canRedeem) return
    setShowRedeemConfirm(true)
  }

  async function confirmRedeem() {
    setShowRedeemConfirm(false)
    if (redeemingRef.current || loadingRef.current || !canRedeem) return
    const accountID = account.id
    const current = generation.current
    pendingKey.current ??= newOperationKey(accountID)
    setRedeeming(true)
    setRedeemFeedback(null)
    try {
      const result = await redeemClaudeResetCredit(accountID, pendingKey.current)
      if (current !== generation.current) return
      // A definite server answer ends this confirmation; the next one gets a new key.
      pendingKey.current = null
      setRedeemFeedback(outcomeFeedback(result))
      setRedeeming(false)
      onRedeemed?.(result)
      await refresh()
    } catch (e) {
      if (current !== generation.current) return
      // Transport or unknown errors keep the key so a retry replays server-side.
      if (preClaimRefusals.has((e as { reason?: string })?.reason ?? '')) pendingKey.current = null
      setRedeemFeedback({ kind: 'error', text: errorText(e) })
    } finally {
      if (current === generation.current) setRedeeming(false)
    }
  }

  const feedbackClass =
    redeemFeedback?.kind === 'success'
      ? styles.successTiny
      : redeemFeedback?.kind === 'warning'
        ? styles.warningTiny
        : styles.errorTiny

  /*
    Same action row layout as OpenAIQuotaResetCell: the parent's local
    "查询" button is passed in via preActions so related buttons share one
    row. The reset count only shows for Anthropic OAuth accounts; the slot always
    renders. The count button is read-only; only the orange reset button,
    after a query shows a redeemable credit and the operator confirms,
    consumes one reset.
  */
  return (
    <div className={[styles.stack, className].filter(Boolean).join(' ')}>
      <div className={styles.actionsRow}>
        {preActions}

        {visible ? (
          <button
            type="button"
            data-testid="claude-reset-count"
            className={styles.action}
            disabled={loading || redeeming}
            title={countButtonTitle}
            onClick={() => void refresh()}
          >
            <RefreshCw className={[styles.actionIcon, loading ? styles.spin : ''].join(' ')} aria-hidden="true" />
            {t('admin.accounts.claudeResetCredits.count')}
            {status ? <span style={{ marginLeft: 2, fontVariantNumeric: 'tabular-nums' }}>{totalResets}</span> : null}
          </button>
        ) : null}

        {visible ? (
          <button
            type="button"
            data-testid="claude-reset-redeem"
            className={styles.action}
            data-tone="warning"
            disabled={redeeming || loading || !canRedeem}
            title={redeemButtonTitle}
            onClick={openRedeemConfirm}
          >
            <RotateCw className={[styles.actionIcon, redeeming ? styles.spin : ''].join(' ')} aria-hidden="true" />
            {t('admin.accounts.claudeResetCredits.reset')}
          </button>
        ) : null}
      </div>

      {visible && status && (primaryCredit || !status.eligible || cooldownActive) ? (
        <div className={styles.wrapRow}>
          {primaryCredit?.expires_at ? (
            <span data-testid="claude-reset-expiry" className={styles.tag} title={creditTitle}>
              {t('admin.accounts.claudeResetCredits.expiresAt', { time: formatTime(primaryCredit.expires_at, 'short') })}
            </span>
          ) : null}
          {status.eligible && totalResets > 0 && status.available_count === 0 ? (
            <span data-testid="claude-reset-not-usable" className={styles.mutedLine}>
              {t('admin.accounts.claudeResetCredits.notUsableNow')}
            </span>
          ) : null}
          {!status.eligible ? (
            <span className={styles.warningTiny}>{t('admin.accounts.claudeResetCredits.ineligible')}</span>
          ) : null}
          {cooldownActive && cooldownUntil ? (
            <span data-testid="claude-reset-cooldown" className={styles.warningTiny}>
              {t('admin.accounts.claudeResetCredits.cooldown', { time: formatTime(cooldownUntil, 'short') })}
            </span>
          ) : null}
        </div>
      ) : null}

      {visible && error ? (
        <div role="alert" className={styles.errorTiny}>
          {t('admin.accounts.claudeResetCredits.error')}
        </div>
      ) : null}
      {visible && redeemFeedback ? (
        <div
          data-testid="claude-reset-feedback"
          role={redeemFeedback.kind === 'success' ? 'status' : 'alert'}
          className={feedbackClass}
          data-kind={redeemFeedback.kind}
          title={redeemFeedback.text}
        >
          {redeemFeedback.text}
        </div>
      ) : null}

      {visible ? (
        <ConfirmDialog
          show={showRedeemConfirm}
          title={t('admin.accounts.claudeResetCredits.confirmTitle')}
          message={confirmMessage}
          confirmText={t('admin.accounts.claudeResetCredits.reset')}
          cancelText={t('common.cancel')}
          danger
          onConfirm={() => void confirmRedeem()}
          onCancel={() => setShowRedeemConfirm(false)}
        />
      ) : null}
    </div>
  )
}
