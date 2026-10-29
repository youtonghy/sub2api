/**
 * 账号容量单元格，对应 Vue 版 AccountCapacityCell.vue：
 * 并发槽位、5h 窗口费用、会话数、RPM（仅 Anthropic OAuth / Setup Token），以及 API Key 类账号的日 / 周 / 总配额。
 */
import { CircleDollarSign, Clock, LayoutGrid, Users } from 'lucide-react'

import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import { supportsAccountQuota } from '@/utils/accountQuota'
import CapacityBadge, { type CapacityTone } from './CapacityBadge'
import QuotaBadge from './QuotaBadge'
import styles from './AccountCapacityCell.module.css'

export interface AccountCapacityCellProps {
  account: Account
}

// 格式化费用显示
const formatCost = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '0'
  return value.toFixed(2)
}

export default function AccountCapacityCell({ account }: AccountCapacityCellProps) {
  const { t } = useI18n()

  // ====== 并发 ======
  const currentConcurrency = account.current_concurrency || 0
  const concurrencyTone: CapacityTone =
    currentConcurrency >= account.concurrency ? 'danger' : currentConcurrency > 0 ? 'warning' : 'neutral'

  // ====== 窗口费用 ======
  const isAnthropicOAuthOrSetupToken =
    account.platform === 'anthropic' && (account.type === 'oauth' || account.type === 'setup-token')

  const showWindowCost =
    isAnthropicOAuthOrSetupToken && account.window_cost_limit != null && account.window_cost_limit > 0
  const currentWindowCost = account.current_window_cost ?? 0

  let windowCostTone: CapacityTone = 'neutral'
  let windowCostTooltip = ''
  if (showWindowCost) {
    const limit = account.window_cost_limit || 0
    const reserve = account.window_cost_sticky_reserve || 10
    if (currentWindowCost >= limit + reserve) {
      windowCostTone = 'danger'
      windowCostTooltip = t('admin.accounts.capacity.windowCost.blocked')
    } else if (currentWindowCost >= limit) {
      windowCostTone = 'orange'
      windowCostTooltip = t('admin.accounts.capacity.windowCost.stickyOnly')
    } else {
      windowCostTone = currentWindowCost >= limit * 0.8 ? 'warning' : 'success'
      windowCostTooltip = t('admin.accounts.capacity.windowCost.normal')
    }
  }

  // ====== 会话限制 ======
  const showSessionLimit = isAnthropicOAuthOrSetupToken && account.max_sessions != null && account.max_sessions > 0
  const activeSessions = account.active_sessions ?? 0
  let sessionLimitTone: CapacityTone = 'neutral'
  let sessionLimitTooltip = ''
  if (showSessionLimit) {
    const max = account.max_sessions || 0
    const idle = account.session_idle_timeout_minutes || 5
    sessionLimitTone = activeSessions >= max ? 'danger' : activeSessions >= max * 0.8 ? 'warning' : 'success'
    sessionLimitTooltip =
      activeSessions >= max
        ? t('admin.accounts.capacity.sessions.full', { idle })
        : t('admin.accounts.capacity.sessions.normal', { idle })
  }

  // ====== RPM ======
  const showRpmLimit = isAnthropicOAuthOrSetupToken && account.base_rpm != null && account.base_rpm > 0
  const currentRPM = account.current_rpm ?? 0
  const rpmStrategy = account.rpm_strategy || 'tiered'
  const rpmStrategyTag = rpmStrategy === 'sticky_exempt' ? '[S]' : '[T]'
  const rpmBase = account.base_rpm || 0
  const rpmBuffer = account.rpm_sticky_buffer ?? (rpmBase > 0 ? Math.max(1, Math.floor(rpmBase / 5)) : 0)

  let rpmTone: CapacityTone = 'neutral'
  let rpmTooltip = ''
  if (showRpmLimit) {
    const base = account.base_rpm ?? 0
    const buffer = rpmBuffer
    if (rpmStrategy === 'tiered') {
      if (currentRPM >= base + buffer) rpmTone = 'danger'
      else if (currentRPM >= base) rpmTone = 'orange'
      else rpmTone = currentRPM >= base * 0.8 ? 'warning' : 'success'

      if (currentRPM >= base + buffer) rpmTooltip = t('admin.accounts.capacity.rpm.tieredBlocked', { buffer })
      else if (currentRPM >= base) rpmTooltip = t('admin.accounts.capacity.rpm.tieredStickyOnly', { buffer })
      else if (currentRPM >= base * 0.8) rpmTooltip = t('admin.accounts.capacity.rpm.tieredWarning')
      else rpmTooltip = t('admin.accounts.capacity.rpm.tieredNormal')
    } else {
      if (currentRPM >= base) rpmTone = 'orange'
      else rpmTone = currentRPM >= base * 0.8 ? 'warning' : 'success'

      if (currentRPM >= base) rpmTooltip = t('admin.accounts.capacity.rpm.stickyExemptOver')
      else if (currentRPM >= base * 0.8) rpmTooltip = t('admin.accounts.capacity.rpm.stickyExemptWarning')
      else rpmTooltip = t('admin.accounts.capacity.rpm.stickyExemptNormal')
    }
  }

  // ====== 配额 ======
  const isQuotaEligible = supportsAccountQuota(account.type)
  const showDailyQuota = isQuotaEligible && account.quota_daily_limit != null && account.quota_daily_limit > 0
  const showWeeklyQuota = isQuotaEligible && account.quota_weekly_limit != null && account.quota_weekly_limit > 0
  const showTotalQuota = isQuotaEligible && account.quota_limit != null && account.quota_limit > 0

  return (
    <div className={styles.stack}>
      {/* 并发槽位 */}
      <CapacityBadge tone={concurrencyTone} current={currentConcurrency} max={account.concurrency}>
        <LayoutGrid aria-hidden="true" />
      </CapacityBadge>

      {/* 5h窗口费用限制 */}
      {showWindowCost ? (
        <CapacityBadge
          tone={windowCostTone}
          tooltip={windowCostTooltip}
          current={'$' + formatCost(currentWindowCost)}
          max={'$' + formatCost(account.window_cost_limit)}
        >
          <CircleDollarSign aria-hidden="true" />
        </CapacityBadge>
      ) : null}

      {/* 会话数量限制 */}
      {showSessionLimit ? (
        <CapacityBadge
          tone={sessionLimitTone}
          tooltip={sessionLimitTooltip}
          current={activeSessions}
          max={account.max_sessions!}
        >
          <Users aria-hidden="true" />
        </CapacityBadge>
      ) : null}

      {/* RPM 限制 */}
      {showRpmLimit ? (
        <CapacityBadge
          tone={rpmTone}
          tooltip={rpmTooltip}
          current={currentRPM}
          max={account.base_rpm!}
          suffix={rpmStrategyTag}
        >
          <Clock aria-hidden="true" />
        </CapacityBadge>
      ) : null}

      {/* API Key 账号配额限制 */}
      {showDailyQuota ? (
        <QuotaBadge used={account.quota_daily_used ?? 0} limit={account.quota_daily_limit!} label="D" />
      ) : null}
      {showWeeklyQuota ? (
        <QuotaBadge used={account.quota_weekly_used ?? 0} limit={account.quota_weekly_limit!} label="W" />
      ) : null}
      {showTotalQuota ? <QuotaBadge used={account.quota_used ?? 0} limit={account.quota_limit!} /> : null}
    </div>
  )
}
