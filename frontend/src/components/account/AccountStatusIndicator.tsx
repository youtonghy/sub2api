/**
 * 账号状态指示，对应 Vue 版 AccountStatusIndicator.vue：
 * 主状态徽章（429 限流 / 529 过载时改为两行布局并显示恢复时间）、临时不可调度详情入口、
 * 错误信息提示、模型级限流 / 积分状态列表。
 */
import { CircleHelp, TriangleAlert } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Tooltip } from '@/components/arc/tooltip/tooltip'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import {
  formatCountdown,
  formatCountdownWithSuffix,
  formatDateTime,
  formatDateTimeToMinute,
  formatTime
} from '@/utils/format'
import miniBadge from './miniBadge.module.css'
import styles from './AccountStatusIndicator.module.css'

export interface AccountStatusIndicatorProps {
  account: Account
  onShowTempUnsched?: (account: Account) => void
}

type AccountModelStatusItem = {
  kind: 'rate_limit' | 'credits_exhausted' | 'credits_active'
  model: string
  reset_at: string
}

const scopeAliases: Record<string, string> = {
  // Claude 系列
  'claude-fable-5-1': 'CFable51',
  'claude-fable-5': 'CFable5',
  'claude-opus-4-6': 'COpus46',
  'claude-opus-4-6-thinking': 'COpus46T',
  'claude-opus-4-7': 'COpus47',
  'claude-opus-4-8': 'COpus48',
  'claude-opus-5-5': 'COpus55',
  'claude-opus-5': 'COpus5',
  'claude-sonnet-4-6': 'CSon46',
  'claude-sonnet-4-5': 'CSon45',
  'claude-sonnet-4-5-thinking': 'CSon45T',
  'claude-sonnet-5-5': 'CSon55',
  'claude-sonnet-5': 'CSon5',
  // Gemini 2.5 系列
  'gemini-2.5-flash': 'G25F',
  'gemini-2.5-flash-lite': 'G25FL',
  'gemini-2.5-flash-thinking': 'G25FT',
  'gemini-2.5-pro': 'G25P',
  'gemini-2.5-flash-image': 'G25I',
  // Gemini 3.5 系列
  'gemini-3.5-flash': 'G35F',
  // Gemini 3 系列
  'gemini-3-flash': 'G3F',
  'gemini-3.1-pro-high': 'G3PH',
  'gemini-3.1-pro-low': 'G3PL',
  'gemini-3-pro-image': 'G3PI',
  'gemini-3.1-flash-image': 'G31FI',
  // 其他
  'gpt-oss-120b-medium': 'GPT120',
  tab_flash_lite_preview: 'TabFL',
  // 旧版 scope 别名（兼容）
  claude: 'Claude',
  claude_sonnet: 'CSon',
  claude_opus: 'COpus',
  claude_haiku: 'CHaiku',
  gemini_text: 'Gemini',
  gemini_image: 'GImg',
  gemini_flash: 'GFlash',
  gemini_pro: 'GPro'
}

const formatScopeName = (scope: string): string => scopeAliases[scope] || scope

// 普通模型限流 + 积分耗尽 + 走积分中
function getActiveModelStatuses(account: Account): AccountModelStatusItem[] {
  const extra = account.extra as Record<string, unknown> | undefined
  const modelLimits = extra?.model_rate_limits as
    | Record<string, { rate_limited_at: string; rate_limit_reset_at: string }>
    | undefined
  const now = new Date()
  const items: AccountModelStatusItem[] = []

  if (!modelLimits) return items

  // 检查 AICredits key 是否生效（积分是否耗尽）
  const aiCreditsEntry = modelLimits['AICredits']
  const hasActiveAICredits = aiCreditsEntry && new Date(aiCreditsEntry.rate_limit_reset_at) > now
  const allowOverages = !!extra?.allow_overages

  for (const [model, info] of Object.entries(modelLimits)) {
    if (new Date(info.rate_limit_reset_at) <= now) continue

    if (model === 'AICredits') {
      // AICredits key → 积分已用尽
      items.push({ kind: 'credits_exhausted', model, reset_at: info.rate_limit_reset_at })
    } else if (allowOverages && !hasActiveAICredits) {
      // 普通模型限流 + overages 启用 + 积分可用 → 正在走积分
      items.push({ kind: 'credits_active', model, reset_at: info.rate_limit_reset_at })
    } else {
      // 普通模型限流
      items.push({ kind: 'rate_limit', model, reset_at: info.rate_limit_reset_at })
    }
  }

  return items
}

/** 悬停提示，触发元素可聚焦以便键盘用户查看 */
function HoverHint({ content, children }: { content: ReactNode; children: ReactElement }) {
  return <Tooltip content={content}>{children}</Tooltip>
}

export default function AccountStatusIndicator({ account, onShowTempUnsched }: AccountStatusIndicatorProps) {
  const { t } = useI18n()
  const now = new Date()

  // Computed: is rate limited (429)
  const isRateLimited = !!account.rate_limit_reset_at && new Date(account.rate_limit_reset_at) > now
  // Computed: is overloaded (529)
  const isOverloaded = !!account.overload_until && new Date(account.overload_until) > now
  // Computed: is temp unschedulable
  const isTempUnschedulable =
    !!account.temp_unschedulable_until && new Date(account.temp_unschedulable_until) > now
  // Computed: has error status
  const hasError = account.status === 'error'

  const exceeded = (used?: number | null, limit?: number | null) =>
    typeof limit === 'number' && limit > 0 && typeof used === 'number' && used >= limit
  const isQuotaExceeded =
    exceeded(account.quota_used, account.quota_limit) ||
    exceeded(account.quota_daily_used, account.quota_daily_limit) ||
    exceeded(account.quota_weekly_used, account.quota_weekly_limit)

  const activeModelStatuses = getActiveModelStatuses(account)

  // Computed: countdown text for rate limit (429)
  const rateLimitCountdown = formatCountdown(account.rate_limit_reset_at)
  const rateLimitResumeText = rateLimitCountdown
    ? t('admin.accounts.status.rateLimitedAutoResume', { time: rateLimitCountdown })
    : ''
  // Computed: countdown text for overload (529)
  const overloadCountdown = formatCountdownWithSuffix(account.overload_until)

  const tempUnschedRecoveryText =
    isTempUnschedulable && account.temp_unschedulable_until
      ? t('admin.accounts.status.tempUnschedulableUntil', {
          time: formatDateTime(account.temp_unschedulable_until)
        })
      : ''

  // Computed: status badge tone（Vue 版 badge-danger / badge-warning / badge-gray / badge-success）
  let statusTone: BadgeTone = 'success'
  if (hasError) statusTone = 'danger'
  else if (isTempUnschedulable) statusTone = 'warning'
  else if (account.status !== 'active') statusTone = account.status === 'error' ? 'danger' : 'neutral'
  else if (isQuotaExceeded) statusTone = 'warning'
  else if (!account.schedulable) statusTone = 'neutral'

  // Computed: status text
  let statusText: string
  if (hasError) statusText = t('admin.accounts.status.error')
  else if (isTempUnschedulable) statusText = t('admin.accounts.status.tempUnschedulable')
  else if (account.status !== 'active') statusText = t(`admin.accounts.status.${account.status}`)
  else if (isQuotaExceeded) statusText = t('admin.accounts.status.quotaExceeded')
  else if (!account.schedulable) statusText = t('admin.accounts.status.paused')
  else statusText = t(`admin.accounts.status.${account.status}`)

  const handleTempUnschedClick = () => {
    if (!isTempUnschedulable) return
    onShowTempUnsched?.(account)
  }

  const modelStatusTitle = (item: AccountModelStatusItem) =>
    item.kind === 'credits_exhausted'
      ? t('admin.accounts.status.creditsExhaustedUntil', { time: formatDateTimeToMinute(item.reset_at) })
      : item.kind === 'credits_active'
        ? t('admin.accounts.status.modelCreditOveragesUntil', {
            model: formatScopeName(item.model),
            time: formatDateTimeToMinute(item.reset_at)
          })
        : t('admin.accounts.status.modelRateLimitedUntil', {
            model: formatScopeName(item.model),
            time: formatDateTimeToMinute(item.reset_at)
          })

  const modelLayout =
    activeModelStatuses.length <= 4 ? 'stack' : activeModelStatuses.length <= 8 ? 'columns2' : 'columns3'

  let mainStatus: ReactNode
  if (isRateLimited) {
    // Rate Limit Display (429) - Two-line layout
    mainStatus = (
      <div className={styles.twoLine}>
        <Badge size="sm" tone="warning" data-tone="warning" data-testid="account-status-badge">
          {t('admin.accounts.status.rateLimited')}
        </Badge>
        <span className={styles.caption}>{rateLimitResumeText}</span>
      </div>
    )
  } else if (isOverloaded) {
    // Overload Display (529) - Two-line layout
    mainStatus = (
      <div className={styles.twoLine}>
        <Badge size="sm" tone="danger" data-tone="danger" data-testid="account-status-badge">
          {t('admin.accounts.status.overloaded')}
        </Badge>
        <span className={styles.caption}>{overloadCountdown}</span>
      </div>
    )
  } else if (isTempUnschedulable) {
    mainStatus = (
      <div className={styles.twoLine}>
        <button
          type="button"
          className={styles.badgeButton}
          title={t('admin.accounts.status.viewTempUnschedDetails')}
          onClick={handleTempUnschedClick}
        >
          <Badge size="sm" tone={statusTone} data-tone={statusTone} data-testid="account-status-badge">
            {statusText}
          </Badge>
        </button>
        <span className={`${styles.caption} ${styles.recovery}`}>{tempUnschedRecoveryText}</span>
      </div>
    )
  } else {
    mainStatus = (
      <Badge size="sm" tone={statusTone} data-tone={statusTone} data-testid="account-status-badge">
        {statusText}
      </Badge>
    )
  }

  return (
    <div className={styles.root}>
      {mainStatus}

      {/* Error Info Indicator */}
      {hasError && account.error_message ? (
        <HoverHint content={<div className={styles.errorMessage}>{account.error_message}</div>}>
          <span className={styles.errorIcon} tabIndex={0} aria-label={account.error_message}>
            <CircleHelp aria-hidden="true" />
          </span>
        </HoverHint>
      ) : null}

      {/* Rate Limit Indicator (429) */}
      {isRateLimited ? (
        <HoverHint
          content={t('admin.accounts.status.rateLimitedUntil', { time: formatDateTime(account.rate_limit_reset_at) })}
        >
          <span className={`${miniBadge.badge} ${miniBadge.warning} ${styles.code}`} tabIndex={0}>
            <TriangleAlert aria-hidden="true" />
            429
          </span>
        </HoverHint>
      ) : null}

      {/* Model Status Indicators (普通限流 / 超量请求中) */}
      {activeModelStatuses.length > 0 ? (
        <div className={styles[modelLayout]}>
          {activeModelStatuses.map((item) => (
            <div key={`${item.kind}-${item.model}`} className={styles.modelItem}>
              <HoverHint content={modelStatusTitle(item)}>
                {item.kind === 'credits_exhausted' ? (
                  // 积分已用尽
                  <span className={`${miniBadge.badge} ${miniBadge.danger} ${styles.code}`} tabIndex={0}>
                    <TriangleAlert aria-hidden="true" />
                    {t('admin.accounts.status.creditsExhausted')}
                    <span className={styles.countdown}>{formatCountdown(item.reset_at)}</span>
                  </span>
                ) : item.kind === 'credits_active' ? (
                  // 正在走积分（模型限流但积分可用）
                  <span className={`${miniBadge.badge} ${miniBadge.warning} ${styles.code}`} tabIndex={0}>
                    <span>⚡</span>
                    {formatScopeName(item.model)}
                    <span className={styles.countdown}>{formatCountdown(item.reset_at)}</span>
                  </span>
                ) : (
                  // 普通模型限流
                  <span className={`${miniBadge.badge} ${miniBadge.info} ${styles.code}`} tabIndex={0}>
                    <TriangleAlert aria-hidden="true" />
                    {formatScopeName(item.model)}
                    <span className={styles.countdown}>{formatCountdown(item.reset_at)}</span>
                  </span>
                )}
              </HoverHint>
            </div>
          ))}
        </div>
      ) : null}

      {/* Overload Indicator (529) */}
      {isOverloaded ? (
        <HoverHint content={t('admin.accounts.status.overloadedUntil', { time: formatTime(account.overload_until) })}>
          <span className={`${miniBadge.badge} ${miniBadge.danger} ${styles.code}`} tabIndex={0}>
            <TriangleAlert aria-hidden="true" />
            529
          </span>
        </HoverHint>
      ) : null}
    </div>
  )
}
